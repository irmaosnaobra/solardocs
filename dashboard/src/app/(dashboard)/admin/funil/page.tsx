'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

type Period = 'hoje' | 'ontem' | '3dias' | '7dias' | 'mes' | 'maximo';

interface FunnelStep {
  key: 'vsl' | 'landing' | 'cadastro' | 'stripe' | 'empresa' | 'plataforma';
  label: string;
  count: number;
  sub?: string;
  detail?: {
    closed: number;
    byProduct: Record<string, number>;
  };
}
interface FunnelData {
  period: Period;
  since: string;
  steps: FunnelStep[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'hoje',   label: 'Hoje' },
  { value: 'ontem',  label: 'Ontem' },
  { value: '3dias',  label: '3 dias' },
  { value: '7dias',  label: '7 dias' },
  { value: 'mes',    label: 'Esse mês' },
  { value: 'maximo', label: 'Máximo' },
];

// Cores por etapa — degradê quente da VSL → laranja da plataforma
const STEP_COLORS: Record<FunnelStep['key'], { bg: string; border: string; accent: string }> = {
  vsl:        { bg: 'rgba(139, 92, 246, 0.10)', border: 'rgba(139, 92, 246, 0.30)', accent: '#a78bfa' },
  landing:    { bg: 'rgba(59, 130, 246, 0.10)', border: 'rgba(59, 130, 246, 0.30)', accent: '#60a5fa' },
  cadastro:   { bg: 'rgba(16, 185, 129, 0.10)', border: 'rgba(16, 185, 129, 0.30)', accent: '#34d399' },
  stripe:     { bg: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.30)', accent: '#fbbf24' },
  empresa:    { bg: 'rgba(20, 184, 166, 0.10)', border: 'rgba(20, 184, 166, 0.30)', accent: '#2dd4bf' },
  plataforma: { bg: 'rgba(239, 68, 68, 0.10)',  border: 'rgba(239, 68, 68, 0.30)',  accent: '#f87171' },
};

const STEP_DESCRIPTIONS: Record<FunnelStep['key'], string> = {
  vsl:        'Acessaram a página do vídeo de venda',
  landing:    'Tráfego frio (Google/indicação) — VSL pula direto pro cadastro',
  cadastro:   'Criaram conta na plataforma',
  stripe:     'Passaram cartão (inclui cancelados no trial)',
  empresa:    'Preencheram CNPJ pós-pagamento (gate pra emitir documento)',
  plataforma: 'Geraram ao menos 1 documento',
};

// Etapas fora do caminho principal. Continuam mostradas mas marcadas como
// PAUSADA e ignoradas no cálculo de conversão do funil. Landing virou rota
// secundária quando VSL passou a redirecionar direto pra /auth.
const PAUSED_STEPS = new Set<FunnelStep['key']>(['landing']);

const PRODUCT_LABEL: Record<string, string> = {
  pro: 'PRO',
  ilimitado: 'Ilimitado',
};

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default function FunilPage() {
  const [period, setPeriod] = useState<Period>('hoje');
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
            VSL → Cadastro → Stripe → Empresa → Plataforma · counts únicos por sessão (page_visits) ou usuário (users/documents)
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
          {/* Funil horizontal — cards + setas. Etapas em PAUSED_STEPS aparecem
              muted e o cálculo de conversão pula elas (ex: VSL → Cadastro direto
              ignorando Landing). */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap', marginBottom: 40 }}>
            {data.steps.map((step, i) => {
              const colors = STEP_COLORS[step.key];
              const isPaused = PAUSED_STEPS.has(step.key);

              // Pra etapa ativa, a seta antes dela compara com a última etapa ATIVA
              // anterior (pula as pausadas). Pra etapa pausada, escondemos a seta.
              let prevActive: FunnelStep | null = null;
              if (!isPaused) {
                for (let j = i - 1; j >= 0; j--) {
                  if (!PAUSED_STEPS.has(data.steps[j].key)) {
                    prevActive = data.steps[j];
                    break;
                  }
                }
              }
              const prevPct = prevActive ? pct(step.count, prevActive.count) : null;
              const dropoff = prevActive && prevActive.count > 0
                ? ((prevActive.count - step.count) / prevActive.count * 100).toFixed(1)
                : null;
              const totalPct = (i === 0 || isPaused) ? null : pct(step.count, topCount);

              return (
                <div key={step.key} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 220px', minWidth: 220 }}>
                  {/* Seta entre cards. Não exibe antes do primeiro card nem antes
                      de etapas pausadas (que ficam "soltas" lateralmente). */}
                  {i > 0 && !isPaused && (
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
                  {i > 0 && isPaused && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', minWidth: 40, opacity: 0.3 }}>
                      <div style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>┄</div>
                    </div>
                  )}

                  {/* Card da etapa */}
                  <div style={{
                    flex: 1,
                    background: colors.bg,
                    border: isPaused ? `1px dashed ${colors.border}` : `1px solid ${colors.border}`,
                    borderRadius: 16,
                    padding: '20px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    position: 'relative',
                    overflow: 'hidden',
                    opacity: isPaused ? 0.55 : 1,
                  }}>
                    {isPaused && (
                      <div style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        fontSize: 9,
                        fontWeight: 900,
                        letterSpacing: '0.14em',
                        padding: '3px 7px',
                        borderRadius: 4,
                        background: 'rgba(239, 68, 68, 0.18)',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                      }}>
                        PAUSADA
                      </div>
                    )}
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
                    {step.key === 'stripe' && step.detail && (
                      <div style={{
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: `1px solid ${colors.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text)' }}>
                          {step.detail.closed} {step.detail.closed === 1 ? 'fechou' : 'fecharam'}{' '}
                          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                            (passou do trial)
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {Object.entries(step.detail.byProduct).map(([plano, n], idx, arr) => (
                            <span key={plano}>
                              <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>
                                {PRODUCT_LABEL[plano] ?? plano}
                              </span>: {n}
                              {idx < arr.length - 1 ? '  •  ' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
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

          {/* Resumo de conversões macro. Primeira linha = fluxo principal
              (VSL → Cadastro → Stripe → Empresa → Ativo). LP fria fica no fim,
              separada, pra dar visibilidade ao tráfego não-VSL sem confundir o KPI.
              Índices: 0=vsl, 1=landing, 2=cadastro, 3=stripe, 4=empresa, 5=plataforma. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { label: 'VSL → Cadastro',     val: pct(data.steps[2].count, data.steps[0].count) },
              { label: 'Cadastro → Stripe',  val: pct(data.steps[3].count, data.steps[2].count) },
              { label: 'Stripe → Empresa',   val: pct(data.steps[4].count, data.steps[3].count) },
              { label: 'Empresa → Ativo',    val: pct(data.steps[5].count, data.steps[4].count) },
              { label: 'VSL → Pagante',      val: pct(data.steps[3].count, data.steps[0].count) },
              { label: 'VSL → Ativo',        val: pct(data.steps[5].count, data.steps[0].count) },
              { label: 'LP fria → Cadastro', val: pct(data.steps[2].count, data.steps[1].count), muted: true },
            ].map(m => (
              <div key={m.label} style={{
                background: 'var(--color-surface)',
                border: m.muted ? '1px dashed var(--color-border)' : '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '16px 18px',
                opacity: m.muted ? 0.55 : 1,
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
            visitantes únicos por sessão (VSL/Landing) e usuários distintos (Cadastro/Stripe/Empresa/Plataforma).
            "Pageviews" no canto inferior conta o total de visitas (com re-visita). VSL conta acessos a
            <code style={{ padding: '0 4px' }}>/apresentacao</code>; Landing conta a home
            <code style={{ padding: '0 4px' }}>solardoc.app/</code> (excluindo /io, /gerador, /auth, /apresentacao).
            <br /><br />
            <strong style={{ color: '#2dd4bf' }}>Empresa:</strong> users que preencheram CNPJ em
            <code style={{ padding: '0 4px' }}>/empresa</code> pós-pagamento. É gate obrigatório pra emitir
            documentos — drop entre Stripe e Empresa = pagantes que não terminam o onboarding.
            <br /><br />
            <strong style={{ color: '#f87171' }}>Landing PAUSADA:</strong> quem vem da VSL é redirecionado direto
            pro cadastro, pulando a LP. A Landing aparece muted só pra dar visibilidade ao tráfego frio (Google/indicação)
            que ainda chega pela home. O cálculo VSL → Cadastro pula a Landing.
          </div>
        </>
      )}
    </div>
  );
}
