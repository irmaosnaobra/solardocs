'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import api from '@/services/api';
import styles from './home.module.css';

interface User {
  email: string;
  plano: string;
  documentos_usados: number;
  limite_documentos: number;
  created_at: string;
}

interface Doc {
  id: string;
  tipo: string;
  cliente_nome?: string;
  status: string;
  created_at: string;
}

const TIPO_LABEL: Record<string, string> = {
  contratoSolar:    'Contrato Solar',
  prestacaoServico: 'Prestação de Serviço',
  procuracao:       'Procuração',
  contratoPJ:       'Contrato PJ',
  propostaBanco:    'Proposta Bancária',
};

const TIPO_ICON: Record<string, string> = {
  contratoSolar:    '☀️',
  prestacaoServico: '🔧',
  procuracao:       '📜',
  contratoPJ:       '🤝',
  propostaBanco:    '🏦',
};

const TIPO_HREF: Record<string, string> = {
  contratoSolar:    '/documentos/contrato-solar',
  prestacaoServico: '/documentos/prestacao-servico',
  procuracao:       '/documentos/procuracao',
  contratoPJ:       '/documentos/contrato-pj',
  propostaBanco:    '/documentos/proposta-bancaria',
};

const PIE_COLORS = ['#f59e0b', '#6366f1', '#22c55e', '#ec4899', '#14b8a6'];

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function getLastSixMonths() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTH_NAMES[d.getMonth()] };
  });
}

function buildMonthlyData(docs: Doc[]) {
  const months = getLastSixMonths();
  const counts: Record<string, number> = {};
  months.forEach(m => { counts[m.key] = 0; });
  docs.forEach(doc => {
    const key = doc.created_at.slice(0, 7);
    if (key in counts) counts[key]++;
  });
  return months.map(m => ({ mes: m.label, docs: counts[m.key] }));
}

function buildTipoData(docs: Doc[]) {
  const counts: Record<string, number> = {};
  docs.forEach(doc => {
    const label = TIPO_LABEL[doc.tipo] ?? doc.tipo;
    counts[label] = (counts[label] ?? 0) + 1;
  });
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

function StatCard({ icon, value, label, sub, href, barPercent, barDanger }: {
  icon: string; value: string | number; label: string; sub?: string;
  href?: string; barPercent?: number; barDanger?: boolean;
}) {
  const inner = (
    <div className={`${styles.statCard} ${href ? styles.statCardLink : ''}`}>
      <div className={styles.statIcon}>{icon}</div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
      {barPercent !== undefined && (
        <div className={styles.statBar}>
          <div
            className={`${styles.statBarFill} ${barDanger ? styles.statBarDanger : ''}`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      <div className={styles.tooltipValue}>{payload[0].value} documento{payload[0].value !== 1 ? 's' : ''}</div>
    </div>
  );
};

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [clientesCount, setClientesCount] = useState(0);
  const [terceirosCount, setTerceirosCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/auth/me'),
      api.get('/clients'),
      api.get('/terceiros'),
      api.get('/documents/list'),
    ]).then(([meRes, cliRes, tercRes, docsRes]) => {
      setUser(meRes.data.user);
      setClientesCount(cliRes.data.clients?.length ?? 0);
      setTerceirosCount(tercRes.data.terceiros?.length ?? 0);
      setDocs(docsRes.data.documents ?? []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.loading}>Carregando...</div>;
  if (!user) return null;

  const isIlimitado = user.plano === 'ilimitado';
  const docPercent   = isIlimitado ? 0 : Math.min((user.documentos_usados / user.limite_documentos) * 100, 100);
  const docsRestantes = isIlimitado ? null : user.limite_documentos - user.documentos_usados;

  const monthlyData = buildMonthlyData(docs);
  const tipoData    = buildTipoData(docs);

  // Tipo mais usado
  const tipoMaisUsado = tipoData.sort((a, b) => b.value - a.value)[0];

  // Docs este mês
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const docsMes = docs.filter(d => d.created_at.slice(0, 7) === thisMonthKey).length;

  // Dias desde o cadastro
  const diasAtivo = user.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000)
    : 0;

  return (
    <div className={styles.page}>

      {/* ── SAUDAÇÃO ── */}
      <div className={styles.greeting}>
        <h1 className={styles.greetingTitle}>Dashboard</h1>
        <p className={styles.greetingEmail}>{user.email} · <span className={styles.planTag}>{user.plano.toUpperCase()}</span></p>
      </div>

      {/* ── STATS ── */}
      <div className={styles.statsGrid}>
        <StatCard
          icon="📄"
          value={docs.length}
          label="Documentos gerados"
          sub="Total histórico"
        />
        <StatCard
          icon="📅"
          value={docsMes}
          label={isIlimitado ? 'Documentos este mês' : `${docsMes} / ${user.limite_documentos} este mês`}
          sub={docsRestantes !== null ? `${docsRestantes} restante${docsRestantes !== 1 ? 's' : ''}` : 'Uso ilimitado'}
          barPercent={isIlimitado ? undefined : docPercent}
          barDanger={docPercent >= 90}
        />
        <StatCard icon="👥" value={clientesCount} label="Clientes cadastrados" href="/clientes" />
        <StatCard icon="🤝" value={terceirosCount} label="Terceiros cadastrados" href="/terceiros" />
        <StatCard icon="🗓️" value={diasAtivo} label="Dias na plataforma" sub={`Desde ${new Date(user.created_at).toLocaleDateString('pt-BR')}`} />
        {tipoMaisUsado && (
          <StatCard
            icon={Object.entries(TIPO_LABEL).find(([, v]) => v === tipoMaisUsado.name)?.[0] ? TIPO_ICON[Object.entries(TIPO_LABEL).find(([, v]) => v === tipoMaisUsado.name)![0]] : '📄'}
            value={tipoMaisUsado.value}
            label="Tipo mais gerado"
            sub={tipoMaisUsado.name}
          />
        )}
      </div>

      {/* ── GRÁFICOS ── */}
      {docs.length > 0 && (
        <div className={styles.chartsRow}>

          {/* Bar Chart — por mês */}
          <div className={styles.chartCard}>
            <h2 className={styles.chartTitle}>Documentos por mês</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} barSize={28}>
                <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(245,158,11,0.06)' }} />
                <Bar dataKey="docs" fill="#f59e0b" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart — por tipo */}
          <div className={styles.chartCard}>
            <h2 className={styles.chartTitle}>Documentos por tipo</h2>
            {tipoData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={tipoData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {tipoData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend
                    formatter={(value) => <span style={{ fontSize: 12, color: '#94a3b8' }}>{value}</span>}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Tooltip formatter={(v: number) => [`${v} doc${v !== 1 ? 's' : ''}`, '']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className={styles.emptyChart}>Nenhum dado ainda</p>
            )}
          </div>
        </div>
      )}

      {/* ── ATALHOS ── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Gerar novo documento</h2>
        <div className={styles.quickGrid}>
          {Object.entries(TIPO_LABEL).map(([tipo, label]) => (
            <Link key={tipo} href={TIPO_HREF[tipo]} className={styles.quickCard}>
              <span className={styles.quickIcon}>{TIPO_ICON[tipo]}</span>
              <span className={styles.quickLabel}>{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── HISTÓRICO ── */}
      {docs.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Histórico de documentos</h2>
          <div className={styles.histTable}>
            <div className={styles.histHeader}>
              <span>Documento</span>
              <span>Cliente / Terceiro</span>
              <span>Data</span>
            </div>
            {docs.slice(0, 10).map(doc => (
              <div key={doc.id} className={styles.histRow}>
                <div className={styles.histTipo}>
                  <span>{TIPO_ICON[doc.tipo] ?? '📄'}</span>
                  <span>{TIPO_LABEL[doc.tipo] ?? doc.tipo}</span>
                </div>
                <span className={styles.histCliente}>{doc.cliente_nome ?? '—'}</span>
                <span className={styles.histDate}>{new Date(doc.created_at).toLocaleDateString('pt-BR')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {docs.length === 0 && (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>🚀</span>
          <p>Nenhum documento gerado ainda. Comece agora!</p>
        </div>
      )}

    </div>
  );
}
