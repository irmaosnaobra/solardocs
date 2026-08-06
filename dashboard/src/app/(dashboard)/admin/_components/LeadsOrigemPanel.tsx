'use client';

// Leads por Origem — aba do Painel SolarDoc.
// Mostra de ONDE vêm os leads, por etiqueta (produto × canal), com gráfico
// DIÁRIO (barras empilhadas) e ACUMULADO (área empilhada) + totais.
//
// As etiquetas NÃO são fixas: vêm do backend (/admin/leads-origem), que as deriva
// dinamicamente de cada lead. Público novo → etiqueta nova aparece aqui sozinha,
// sem mexer neste arquivo (pedido explícito do dono).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import api from '@/services/api';

interface DiaRow { dia: string; total: number; [etiqueta: string]: string | number; }
interface Resp {
  ok: boolean;
  etiquetas: string[];
  dias: DiaRow[];
  totais: Record<string, number>;
  totalGeral: number;
  hoje: string;
}

// Cor semântica: Solar = âmbar, EP = azul/ciano, Indicado = verde, Import/Manual = neutros.
// Cada produto é uma família e cada CANAL dentro dela tem o seu tom — a mesma
// leitura das pills do Gerador (lá as famílias são verde/laranja; aqui, azul/âmbar,
// que é a paleta deste gráfico). Etiqueta fora desta lista continua ganhando cor
// sozinha pela PALETA_EXTRA — nenhuma fonte nova depende deste arquivo.
const CORES: Record<string, string> = {
  'Solar Tráfego': '#F59E0B',
  'Solar Organic': '#FCD34D',
  'Solar Prospec': '#B45309',
  'EP Tráfego': '#0EA5E9',
  'EP Organic': '#67E8F9',
  'EP Prospec': '#1D4ED8',
  'Indicado': '#10B981',
  'Import': '#94A3B8',
  'Manual': '#C4B5A2',
};
const PALETA_EXTRA = ['#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#EF4444'];
function corDe(et: string, i: number): string {
  return CORES[et] || PALETA_EXTRA[i % PALETA_EXTRA.length];
}

const JANELAS: { label: string; dias: number }[] = [
  { label: '7 dias', dias: 7 },
  { label: '30 dias', dias: 30 },
  { label: '90 dias', dias: 90 },
  { label: 'Tudo', dias: 0 },
];

// YYYY-MM-DD − n dias, em espaço de data pura (UTC) pra não escorregar de fuso.
function subDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
function ddmm(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export default function LeadsOrigemPanel() {
  const [data, setData] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [janela, setJanela] = useState(30); // default 30d — legado (import/manual antigos) não afoga o sinal
  const [ocultas, setOcultas] = useState<Record<string, boolean>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await api.get('/admin/leads-origem');
      setData(r.data);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { error?: string } } })?.response?.data;
      setErro(detail?.error || (e instanceof Error ? e.message : 'Falha ao carregar'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const etiquetas = data?.etiquetas ?? [];
  const visiveis = useMemo(() => etiquetas.filter((e) => !ocultas[e]), [etiquetas, ocultas]);

  // Recorta a janela e monta as duas séries (diária + acumulada) só das linhas visíveis.
  const { diario, acumulado, totaisJanela, totalJanela, primeiroDia } = useMemo(() => {
    const dias = data?.dias ?? [];
    const cutoff = janela > 0 && data?.hoje ? subDays(data.hoje, janela - 1) : '0000-00-00';
    const janelaDias = dias.filter((d) => d.dia >= cutoff);

    const diario = janelaDias.map((d) => {
      const row: Record<string, string | number> = { dia: d.dia };
      for (const et of visiveis) row[et] = Number(d[et] ?? 0);
      return row;
    });

    const acc: Record<string, number> = {};
    const acumulado = janelaDias.map((d) => {
      const row: Record<string, string | number> = { dia: d.dia };
      for (const et of visiveis) {
        acc[et] = (acc[et] ?? 0) + Number(d[et] ?? 0);
        row[et] = acc[et];
      }
      return row;
    });

    const totaisJanela: Record<string, number> = {};
    let totalJanela = 0;
    for (const et of visiveis) {
      const t = janelaDias.reduce((s, d) => s + Number(d[et] ?? 0), 0);
      totaisJanela[et] = t;
      totalJanela += t;
    }
    return { diario, acumulado, totaisJanela, totalJanela, primeiroDia: janelaDias[0]?.dia ?? null };
  }, [data, janela, visiveis]);

  const toggle = (et: string) => setOcultas((o) => ({ ...o, [et]: !o[et] }));

  // ── estilos (mesmo padrão dos outros painéis do admin) ──
  const card: React.CSSProperties = {
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 12, padding: 16, marginBottom: 16,
  };
  const pill = (ativo: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${ativo ? 'var(--color-primary, #F59E0B)' : 'var(--color-border)'}`,
    background: ativo ? 'var(--color-primary, #F59E0B)' : 'transparent',
    color: ativo ? '#fff' : 'var(--color-text)',
  });

  return (
    <div style={{ maxWidth: '100%', padding: '0 4px 32px' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Leads por Origem</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 4, maxWidth: 720 }}>
          De onde cada lead está vindo — por <strong>etiqueta</strong> (produto × canal). Tráfego = anúncio pago no Meta;
          Organic = automação do Instagram. Toda fonte nova gera uma etiqueta nova aqui, automaticamente.
        </p>
      </header>

      {/* Seletor de janela */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {JANELAS.map((j) => (
          <button key={j.dias} style={pill(janela === j.dias)} onClick={() => setJanela(j.dias)}>{j.label}</button>
        ))}
        <button style={{ ...pill(false), marginLeft: 'auto' }} onClick={carregar} disabled={carregando}>
          {carregando ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>

      {erro && (
        <div style={{ ...card, borderColor: '#dc2626', color: '#dc2626' }}>
          Erro ao carregar: {erro}
        </div>
      )}

      {carregando && !data && (
        <div style={{ ...card, color: 'var(--color-text-muted)' }}>Carregando…</div>
      )}

      {data && (
        <>
          {/* KPIs por etiqueta (na janela). Clicável: liga/desliga a série nos gráficos. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <div style={{ ...card, marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-muted)' }}>Total na janela</span>
              <strong style={{ fontSize: 26, fontWeight: 800 }}>{totalJanela}</strong>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{data.totalGeral} no total (tudo)</span>
            </div>
            {etiquetas.map((et, i) => {
              const off = !!ocultas[et];
              const nJan = totaisJanela[et] ?? 0;
              const pct = totalJanela ? Math.round((nJan / totalJanela) * 100) : 0;
              return (
                <button
                  key={et}
                  onClick={() => toggle(et)}
                  title={off ? 'Mostrar' : 'Ocultar'}
                  style={{
                    ...card, marginBottom: 0, textAlign: 'left', cursor: 'pointer',
                    opacity: off ? 0.45 : 1,
                    borderLeft: `4px solid ${corDe(et, i)}`,
                    display: 'flex', flexDirection: 'column', gap: 2,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: corDe(et, i), display: 'inline-block' }} />
                    {et}
                  </span>
                  <strong style={{ fontSize: 22, fontWeight: 800 }}>{nJan}</strong>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {pct}% · {data.totais[et] ?? 0} total
                  </span>
                </button>
              );
            })}
          </div>

          {/* Gráfico DIÁRIO — barras empilhadas por dia */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Leads por dia</div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
              Quantos leads entraram a cada dia, por etiqueta. {primeiroDia ? `Desde ${ddmm(primeiroDia)}.` : ''}
            </p>
            {diario.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Nenhum lead nessa janela.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={diario} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="dia" tickFormatter={ddmm} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={34} />
                  <Tooltip
                    labelFormatter={(l) => `Dia ${ddmm(String(l))}`}
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {visiveis.map((et, i) => (
                    <Bar key={et} dataKey={et} stackId="a" fill={corDe(et, etiquetas.indexOf(et))} radius={i === visiveis.length - 1 ? [3, 3, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Gráfico ACUMULADO — área empilhada (dias acumulados) */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Acumulado</div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
              Soma correndo dia após dia — mostra qual fonte mais cresce ao longo do tempo.
            </p>
            {acumulado.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Nenhum lead nessa janela.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={acumulado} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    {visiveis.map((et) => {
                      const c = corDe(et, etiquetas.indexOf(et));
                      return (
                        <linearGradient key={et} id={`grad-${et.replace(/[^a-zA-Z]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={c} stopOpacity={0.7} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.15} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="dia" tickFormatter={ddmm} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={34} />
                  <Tooltip
                    labelFormatter={(l) => `Até ${ddmm(String(l))}`}
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {visiveis.map((et) => {
                    const c = corDe(et, etiquetas.indexOf(et));
                    return (
                      <Area key={et} type="monotone" dataKey={et} stackId="a" stroke={c} fill={`url(#grad-${et.replace(/[^a-zA-Z]/g, '')})`} strokeWidth={1.5} />
                    );
                  })}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Dias no fuso de São Paulo. Fonte: agendamentos do Gerador (todo lead cai lá). Toque numa etiqueta acima pra ligar/desligar no gráfico.
          </p>
        </>
      )}
    </div>
  );
}
