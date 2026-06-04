'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

type Period = 'hoje' | 'ontem' | '3dias' | '7dias' | 'mes' | 'maximo';

interface FunnelStep {
  key: 'visita' | 'checkout' | 'venda';
  label: string;
  count: number;
  sub?: string;
}
interface FunnelData {
  period: Period;
  since: string;
  steps: FunnelStep[];
  faturamento: number;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'hoje',   label: 'Hoje' },
  { value: 'ontem',  label: 'Ontem' },
  { value: '3dias',  label: '3 dias' },
  { value: '7dias',  label: '7 dias' },
  { value: 'mes',    label: 'Esse mês' },
  { value: 'maximo', label: 'Máximo' },
];

// Degradê azul → amarelo (paleta da landing LimpaPro).
const STEP_COLORS: Record<FunnelStep['key'], { bg: string; border: string; accent: string }> = {
  visita:   { bg: 'rgba(59, 130, 246, 0.10)',  border: 'rgba(59, 130, 246, 0.30)',  accent: 'var(--ink-blue)' },
  checkout: { bg: 'rgba(245, 158, 11, 0.10)',  border: 'rgba(245, 158, 11, 0.30)',  accent: 'var(--ink-amber)' },
  venda:    { bg: 'rgba(16, 185, 129, 0.10)',  border: 'rgba(16, 185, 129, 0.30)',  accent: 'var(--ink-green)' },
};

const STEP_DESCRIPTIONS: Record<FunnelStep['key'], string> = {
  visita:   'Visitaram limpapro.solardoc.app (Pixel + tracking próprio)',
  checkout: 'Clicaram no botão de compra (vão pro checkout)',
  venda:    'Compraram o curso (venda paga confirmada na Kiwify)',
};

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default function FunilLimpaproPanel() {
  const [period, setPeriod] = useState<Period>('7dias');
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<FunnelData>('/admin/funnel-limpapro', { params: { period } });
      setData(data);
    } catch {
      setError('Erro ao carregar funil. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchFunnel(); }, [fetchFunnel]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32, flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
            Funil LimpaPro
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: '6px 0 0' }}>
            Curso de limpeza de placas (Kiwify) · Visita → Clique no checkout → Compra · visitas únicas por sessão, vendas pagas via webhook
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
        <div style={{ padding: 24, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, color: 'var(--ink-red)' }}>
          {error}
        </div>
      )}

      {!loading && data && (() => {
        const steps = data.steps;
        const topCount = steps[0]?.count ?? 0;
        return (
        <>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap', marginBottom: 40 }}>
            {steps.map((step, i, arr) => {
              const colors = STEP_COLORS[step.key];
              const prevStep = i > 0 ? arr[i - 1] : null;
              const prevPct = prevStep ? pct(step.count, prevStep.count) : null;
              const dropoff = prevStep && prevStep.count > 0
                ? ((prevStep.count - step.count) / prevStep.count * 100).toFixed(1)
                : null;
              const totalPct = i === 0 ? null : pct(step.count, topCount);

              return (
                <div key={step.key} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 240px', minWidth: 240 }}>
                  {i > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 6px', minWidth: 70 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {prevPct}
                      </div>
                      <div style={{ fontSize: 22, color: 'var(--color-text-muted)' }}>→</div>
                      {dropoff && Number(dropoff) > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--ink-red)', fontWeight: 700 }}>
                          −{dropoff}%
                        </div>
                      )}
                    </div>
                  )}

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

          {/* Resumo de conversões + faturamento */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {(() => {
              const by = (key: FunnelStep['key']) => steps.find(s => s.key === key)?.count ?? 0;
              const visita = by('visita'), checkout = by('checkout'), venda = by('venda');
              const ticket = venda > 0 ? data.faturamento / venda : 0;
              return [
                { label: 'Visita → Clique',  val: pct(checkout, visita) },
                { label: 'Clique → Compra',  val: pct(venda, checkout) },
                { label: 'Visita → Compra',  val: pct(venda, visita) },
                { label: 'Faturamento',      val: `R$ ${data.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                { label: 'Ticket médio',     val: ticket > 0 ? `R$ ${ticket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—' },
              ];
            })().map(m => (
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
            visitantes únicos por sessão (Visita/Clique) e vendas pagas distintas (Compra).
            "pageviews"/"cliques" no subtítulo contam o total bruto (com re-visita).
            <br /><br />
            <strong style={{ color: 'var(--ink-amber)' }}>Fonte dos dados:</strong> Visita e Clique vêm do
            tracking próprio da landing <code style={{ padding: '0 4px' }}>limpapro.solardoc.app</code>;
            a Compra vem do <b>webhook da Kiwify</b> (só conta venda com status pago). O Pixel da Meta roda
            em paralelo pra otimização de anúncios, mas o número aqui é o do banco — fonte da verdade pra dinheiro.
          </div>
        </>
        );
      })()}
    </div>
  );
}
