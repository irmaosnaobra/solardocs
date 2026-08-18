'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Funil do Pix — bloco separado do funil principal DE PROPÓSITO.
//
// O Pix é um DESVIO do checkout, não uma etapa dele: quem cai aqui já desistiu
// do cartão. Enfiar esses números como passos do funil da operação estragaria
// as porcentagens do topo (a base seria outra) e faria parecer que todo mundo
// que visita a LP passa pela tela de Pix.
//
// Regra do painel: métrica que não dá pra medir aparece como "—", nunca 0.
// Zero aqui leria como "ninguém chegou" quando a verdade pode ser "o rastreio
// ainda não existia".
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';

type Period = 'hoje' | 'ontem' | '7dias' | '30dias' | 'maximo';

interface Passo { key: string; label: string; count: number; sub?: string }
interface PixFunil {
  period: Period;
  medindoDesde: string | null;
  semMedicao: boolean;
  periodoParcial: boolean;
  passos: Passo[];
  porTela: { automatico: { chegou: number; gerou: number }; recorrente: { chegou: number; gerou: number } };
  falhas: { motivo: string; n: number }[];
  banco: { contratos: number; pagos: number; semConta: number };
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'hoje',   label: 'Hoje' },
  { value: 'ontem',  label: 'Ontem' },
  { value: '7dias',  label: '7 dias' },
  { value: '30dias', label: '30 dias' },
  { value: 'maximo', label: 'Máximo' },
];

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

function dataBR(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PixFunilPanel() {
  const [period, setPeriod] = useState<Period>('30dias');
  const [data, setData] = useState<PixFunil | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<PixFunil>('/admin/pix-funil', { params: { period } });
      setData(data);
    } catch {
      setError('Não consegui carregar o funil do Pix.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void carregar(); }, [carregar]);

  const topo = data?.passos[0]?.count ?? 0;

  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
            Saída do checkout → Pix
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: '6px 0 0' }}>
            Quem largou o cartão e caiu na tela de Pix · sessões únicas, não cliques
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6, background: 'var(--color-surface)', padding: 4, borderRadius: 10, border: '1px solid var(--color-border)' }}>
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 700, border: 0, borderRadius: 8, cursor: 'pointer',
                background: period === p.value ? 'var(--color-primary)' : 'transparent',
                color: period === p.value ? '#0f172a' : 'var(--color-text-muted)',
                fontFamily: 'inherit', transition: 'background 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>Carregando…</div>
      )}

      {error && (
        <div style={{ padding: 20, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          {data.semMedicao && (
            <div style={{ padding: 16, marginBottom: 16, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text-muted)', fontSize: 14 }}>
              Ainda não há nenhum registro de visita à tela de Pix. Os números aparecem como <strong>—</strong> porque
              nada foi medido ainda — não porque ninguém entrou.
            </div>
          )}

          {!data.semMedicao && data.periodoParcial && (
            <div style={{ padding: 12, marginBottom: 16, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text-muted)', fontSize: 13 }}>
              Medindo desde <strong>{dataBR(data.medindoDesde)}</strong> — o período escolhido começa antes disso.
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            {data.passos.map((passo, i, arr) => {
              const anterior = i > 0 ? arr[i - 1] : null;
              return (
                <div key={passo.key} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 200px', minWidth: 200 }}>
                  {i > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 6px', minWidth: 64 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
                        {data.semMedicao ? '—' : pct(passo.count, anterior?.count ?? 0)}
                      </div>
                      <div style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>→</div>
                    </div>
                  )}
                  <div style={{
                    flex: 1, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    borderRadius: 16, padding: '20px 18px',
                  }}>
                    <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1 }}>
                      {data.semMedicao ? '—' : passo.count}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>{passo.label}</div>
                    {passo.sub && !data.semMedicao && (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{passo.sub}</div>
                    )}
                    {i > 0 && !data.semMedicao && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, fontWeight: 700 }}>
                        {pct(passo.count, topo)} de quem chegou
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                Por tela
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                <div>Sem conta (veio do anúncio): <strong>{data.semMedicao ? '—' : data.porTela.automatico.chegou}</strong> chegaram, <strong>{data.semMedicao ? '—' : data.porTela.automatico.gerou}</strong> geraram</div>
                <div>Com conta (já é cliente): <strong>{data.semMedicao ? '—' : data.porTela.recorrente.chegou}</strong> chegaram, <strong>{data.semMedicao ? '—' : data.porTela.recorrente.gerou}</strong> geraram</div>
              </div>
            </div>

            {/* Verdade do banco: não depende de rastreio nenhum. Se um dia
                `contratos` ficar MENOR que "geraram o código", o rastreio está
                contando errado — não o contrário. */}
            <div style={{ flex: '1 1 260px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                No banco (independe do rastreio)
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                <div>Contratos criados: <strong>{data.banco.contratos}</strong></div>
                <div>Já pagos: <strong>{data.banco.pagos}</strong></div>
                <div>Sem conta ainda: <strong>{data.banco.semConta}</strong></div>
              </div>
            </div>

            {data.falhas.length > 0 && (
              <div style={{ flex: '1 1 260px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                  Quis pagar e não conseguiu
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                  {data.falhas.map(f => (
                    <div key={f.motivo}>{f.motivo}: <strong>{f.n}</strong></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
