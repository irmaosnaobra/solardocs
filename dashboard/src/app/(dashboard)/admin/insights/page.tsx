'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';

interface KpiNum { label: string; value: string; sub?: string; }
interface PlanilhaKpis {
  faturamentoMes: KpiNum;
  faturamentoTotal: KpiNum;
  vendasMes: KpiNum;
  vendasTotal: KpiNum;
  lucroMedioPct: KpiNum;
  ticketMedio: KpiNum;
  topConsultor: KpiNum;
  topOrigem: KpiNum;
  liberadosCemig: KpiNum;
  ultimasVendas: { codigo: string; nome: string; valor: string; data: string }[];
}
interface TrelloKpis {
  totalAtivo: KpiNum;
  porColuna: { nome: string; qtd: number }[];
}
interface Insights {
  generatedAt: string;
  planilha: PlanilhaKpis | null;
  trello: TrelloKpis | null;
  errors: string[];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return `há ${h}h`;
}

function KpiCard({ k }: { k: KpiNum }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '20px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minHeight: 110,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
      }}>
        {k.label}
      </div>
      <div style={{
        fontSize: 30,
        fontWeight: 800,
        color: 'var(--color-text)',
        lineHeight: 1.1,
        letterSpacing: '-0.5px',
        marginTop: 4,
      }}>
        {k.value}
      </div>
      {k.sub && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {k.sub}
        </div>
      )}
    </div>
  );
}

export default function InsightsPage() {
  const router = useRouter();
  const { user } = useDashboard();
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  // Admin guard — bate na rota direta sem ser admin -> joga pro dashboard
  useEffect(() => {
    if (user && !user.is_admin) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const load = useCallback(async (force = false) => {
    setErr('');
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const { data } = await api.get(`/dashboards/insights${force ? '?force=1' : ''}`);
      setData(data);
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } };
      setErr(er.response?.data?.error || 'Erro ao carregar');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Só carrega se for admin (evita request 403 enquanto redireciona)
    if (user?.is_admin) load();
  }, [load, user]);

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
      Carregando insights…
    </div>
  );

  if (err) return (
    <div style={{ padding: 32, color: '#EF4444' }}>{err}</div>
  );

  if (!data) return null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--color-text)' }}>Insights</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
            Atualizado {timeAgo(data.generatedAt)} · cache 1h
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            cursor: refreshing ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? '⏳ Atualizando…' : '🔄 Atualizar agora'}
        </button>
      </div>

      {data.errors.length > 0 && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 20,
          fontSize: 13,
          color: '#DC2626',
        }}>
          ⚠️ Algumas fontes não responderam:
          <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
            {data.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* PLANILHA */}
      {data.planilha && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 12 }}>
            Planilha Mestre
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}>
            <KpiCard k={data.planilha.faturamentoMes} />
            <KpiCard k={data.planilha.vendasMes} />
            <KpiCard k={data.planilha.faturamentoTotal} />
            <KpiCard k={data.planilha.vendasTotal} />
            <KpiCard k={data.planilha.lucroMedioPct} />
            <KpiCard k={data.planilha.ticketMedio} />
            <KpiCard k={data.planilha.topConsultor} />
            <KpiCard k={data.planilha.topOrigem} />
            <KpiCard k={data.planilha.liberadosCemig} />
          </div>

          {/* Últimas vendas */}
          {data.planilha.ultimasVendas.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8 }}>
                Últimas 5 vendas
              </h3>
              <div style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                overflow: 'hidden',
              }}>
                {data.planilha.ultimasVendas.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '10px 16px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                      fontSize: 13,
                      color: 'var(--color-text)',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)', minWidth: 50 }}>{v.codigo}</span>
                    <span style={{ flex: 1 }}>{v.nome}</span>
                    <span style={{ fontWeight: 700 }}>{v.valor}</span>
                    <span style={{ color: 'var(--color-text-muted)', minWidth: 80, textAlign: 'right' }}>{v.data}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TRELLO */}
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 12 }}>
          Homologação (Trello)
        </h2>
        {data.trello ? (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 12,
            }}>
              <KpiCard k={data.trello.totalAtivo} />
              {data.trello.porColuna.map((c, i) => (
                <KpiCard key={i} k={{ label: c.nome, value: String(c.qtd) }} />
              ))}
            </div>
          </>
        ) : (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 12,
            padding: '20px 16px',
            color: 'var(--color-text-muted)',
            fontSize: 13,
          }}>
            🔒 Trello board não está acessível.
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Pra liberar: abre o board no Trello → Menu → More → Settings → Visibility → <strong>Public</strong>.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
