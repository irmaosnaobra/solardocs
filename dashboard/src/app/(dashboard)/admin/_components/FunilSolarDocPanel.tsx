'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

type Period = 'hoje' | 'ontem' | '3dias' | '7dias' | 'mes' | 'maximo';

interface FunnelStep {
  key: 'vsl' | 'landing' | 'cadastro' | 'stripe' | 'whatsapp' | 'empresa' | 'plataforma';
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

// Monocromático: fundo + label neutros; laranja de marca fica reservado só pro
// "% do topo" (1 acento esparso por card, não os 7 labels inteiros).
const STEP_COLORS: Record<FunnelStep['key'], { bg: string; border: string; accent: string }> = {
  vsl:        { bg: 'var(--color-surface-2)', border: 'var(--color-border)', accent: 'var(--color-text)' },
  landing:    { bg: 'var(--color-surface-2)', border: 'var(--color-border)', accent: 'var(--color-text)' },
  cadastro:   { bg: 'var(--color-surface-2)', border: 'var(--color-border)', accent: 'var(--color-text)' },
  stripe:     { bg: 'var(--color-surface-2)', border: 'var(--color-border)', accent: 'var(--color-text)' },
  whatsapp:   { bg: 'var(--color-surface-2)', border: 'var(--color-border)', accent: 'var(--color-text)' },
  empresa:    { bg: 'var(--color-surface-2)', border: 'var(--color-border)', accent: 'var(--color-text)' },
  plataforma: { bg: 'var(--color-surface-2)', border: 'var(--color-border)', accent: 'var(--color-text)' },
};

const STEP_DESCRIPTIONS: Record<FunnelStep['key'], string> = {
  vsl:        'Acessaram a página do vídeo de venda',
  landing:    'Visitaram a home solardoc.app (LP principal)',
  stripe:     'Passaram cartão no checkout (trial 7 dias)',
  cadastro:   'Criaram conta após o pagamento',
  whatsapp:   'Receberam a boas-vindas no WhatsApp (Giovanna)',
  empresa:    'Preencheram CNPJ na plataforma',
  plataforma: 'Geraram ao menos 1 documento',
};

// VSL faz parte da própria LP (mesmo tráfego) — escondida do funil pra não
// duplicar a contagem de topo. Backend ainda devolve o step; só não renderiza.
const PAUSED_STEPS = new Set<FunnelStep['key']>(['vsl']);

const PRODUCT_LABEL: Record<string, string> = {
  pro: 'PRO',
  ilimitado: 'Ilimitado',
};

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default function FunilSolarDocPanel() {
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32, flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
            Funil da operação SolarDoc
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: '6px 0 0' }}>
            LP → Stripe → WhatsApp → Cadastro → Empresa → Plataforma · counts únicos por sessão (page_visits) ou usuário (users/documents)
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
        <div style={{ padding: 24, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)' }}>
          {error}
        </div>
      )}

      {!loading && data && (() => {
        // Filtra etapas pausadas do render — caminho atual é VSL → Cadastro → Stripe → Empresa → Plataforma.
        const visibleSteps = data.steps.filter(s => !PAUSED_STEPS.has(s.key));
        const topVisibleCount = visibleSteps[0]?.count ?? 0;
        return (
        <>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap', marginBottom: 40 }}>
            {visibleSteps.map((step, i, arr) => {
              const colors = STEP_COLORS[step.key];
              const prevStep = i > 0 ? arr[i - 1] : null;
              const prevPct = prevStep ? pct(step.count, prevStep.count) : null;
              const dropoff = prevStep && prevStep.count > 0
                ? ((prevStep.count - step.count) / prevStep.count * 100).toFixed(1)
                : null;
              const totalPct = i === 0 ? null : pct(step.count, topVisibleCount);

              return (
                <div key={step.key} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 220px', minWidth: 220 }}>
                  {i > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 6px', minWidth: 70 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        {prevPct}
                      </div>
                      <div style={{ fontSize: 22, color: 'var(--color-text-muted)' }}>→</div>
                      {dropoff && Number(dropoff) > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 700 }}>
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
                      <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11, color: 'var(--color-primary)', fontWeight: 700, letterSpacing: '0.04em' }}>
                        {totalPct} do topo
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Conversões — SÓ taxas dentro da mesma unidade de contagem.
              Tráfego (VSL/LP) é por SESSÃO; Stripe é por ASSINATURA (API, todas do período,
              não só as que vieram da LP); Cadastro/Empresa/Plataforma é por PESSOA.
              Cruzar sessão↔assinatura↔pessoa daria taxa sem sentido (podia passar de 100%) —
              sem atribuição UTM→user não dá pra ligar tráfego a pagamento de forma honesta. */}
          {(() => {
            const by = (key: FunnelStep['key']) => data.steps.find(s => s.key === key)?.count ?? 0;
            const cadastro = by('cadastro'),
                  stripe = by('stripe'), empresa = by('empresa'), plataforma = by('plataforma');
            const stripeClosed = data.steps.find(s => s.key === 'stripe')?.detail?.closed ?? 0;

            // Conversão pós-cadastro: tudo por pessoa (users/documents).
            const pessoas = [
              { label: 'Cadastro → Empresa', val: pct(empresa, cadastro), sub: 'pessoas' },
              { label: 'Empresa → Ativo',    val: pct(plataforma, empresa), sub: 'pessoas' },
              { label: 'Cadastro → Ativo',   val: pct(plataforma, cadastro), sub: 'pessoas' },
            ];
            // Checkout Stripe: a própria API distingue quem passou cartão de quem fechou (trial→pago).
            const stripeRates = [
              { label: 'Passou cartão → Fechou', val: pct(stripeClosed, stripe), sub: 'assinaturas' },
            ];

            const Group = ({ title, unit, items }: { title: string; unit: string; items: { label: string; val: string; sub: string }[] }) => (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                  {title} <span style={{ fontWeight: 600, opacity: 0.7 }}>· {unit}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                  {items.map(m => (
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
              </div>
            );

            return (
              <>
                <Group title="Checkout" unit="por assinatura (Stripe)" items={stripeRates} />
                <Group title="Ativação na plataforma" unit="por pessoa" items={pessoas} />
                <div style={{ padding: '12px 16px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                  <b style={{ color: 'var(--color-text)' }}>Por que não tem "LP → Pagante" aqui:</b> tráfego é contado
                  por sessão e pagamento por assinatura — são populações diferentes, e hoje não existe atribuição
                  UTM→usuário no banco pra ligar uma na outra. Mostrar essa taxa daria um número falso (poderia
                  passar de 100%). Quando a atribuição estiver ligada, essa ponte vira real e entra aqui.
                </div>
              </>
            );
          })()}

          {/* Notas */}
          <div style={{ marginTop: 32, padding: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--color-text)' }}>Como ler:</strong> os números são únicos —
            visitantes únicos por sessão (LP) e usuários distintos (Cadastro/Stripe/Empresa/Plataforma).
            "Pageviews" no canto inferior conta o total de visitas (com re-visita). LP conta a home
            <code style={{ padding: '0 4px' }}>solardoc.app</code> (exclui /io, /gerador, /apresentacao).
            A VSL faz parte da própria LP, por isso não aparece como etapa separada.
            <br /><br />
            <strong style={{ color: 'var(--color-text)' }}>Fluxo novo:</strong> o cliente passa o cartão no Stripe
            (trial 7 dias) <b>antes</b> de criar a conta — só cadastra quem pagou. Depois preenche o CNPJ em
            <code style={{ padding: '0 4px' }}>/empresa</code> dentro da plataforma e gera os documentos.
            <br /><br />
            <strong style={{ color: 'var(--color-text)' }}>WhatsApp (forward-only):</strong> conta quem teve a boas-vindas
            da Giovanna <b>disparada</b> no cadastro (tentativa de envio, não entrega confirmada — a Z-API pode
            falhar). Só registra a partir de jun/2026; cadastros anteriores aparecem como 0 nessa etapa.
          </div>
        </>
        );
      })()}
    </div>
  );
}
