'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  FileText, CalendarDays, Users, Handshake, CalendarClock, Sun,
  Wrench, ScrollText, Briefcase, Banknote, FileSignature, ClipboardCheck, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import api from '@/services/api';
import styles from './home.module.css';
import { toBrasilia, fmtDateBR } from '@/utils/brasilia';
import { formatPlanName, firstName } from '@/utils/plan';
import Skeleton, { SkeletonStats } from '@/components/Skeleton/Skeleton';

interface User {
  email: string;
  nome?: string | null;
  plano: string;
  documentos_usados: number;
  limite_documentos: number;
  created_at: string;
  is_admin?: boolean;
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
  contratoPJ:       'Contrato Vendedor',
  propostaBanco:    'Proposta Bancária',
  vistoria:         'Vistoria CheckList',
  propostaSolar:    'Proposta Solar',
};

const TIPO_ICON: Record<string, LucideIcon> = {
  contratoSolar:    FileSignature,
  prestacaoServico: Wrench,
  procuracao:       ScrollText,
  contratoPJ:       Briefcase,
  propostaBanco:    Banknote,
  vistoria:         ClipboardCheck,
  propostaSolar:    Sparkles,
};

const TIPO_HREF: Record<string, string> = {
  contratoSolar:    '/documentos?tipo=contrato-solar',
  prestacaoServico: '/documentos?tipo=prestacao-servico',
  procuracao:       '/documentos?tipo=procuracao',
  contratoPJ:       '/documentos?tipo=contrato-pj',
  propostaBanco:    '/documentos?tipo=proposta-bancaria',
  vistoria:         '/documentos?tipo=vistoria',
  propostaSolar:    '/documentos?tipo=proposta',
};

const PIE_COLORS = ['#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A', '#FEF3C7'];
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

function StatCard({ icon: Icon, value, label, sub, href, barPercent, barDanger }: {
  icon: LucideIcon; value: string | number; label: string; sub?: string;
  href?: string; barPercent?: number; barDanger?: boolean;
}) {
  const inner = (
    <div className={`${styles.statCard} ${href ? styles.statCardLink : ''}`}>
      <div className={styles.statIcon}><Icon size={20} strokeWidth={1.75} /></div>
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

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [clientesCount, setClientesCount] = useState(0);
  const [terceirosCount, setTerceirosCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // allSettled — uma API falhar não derruba a renderização inteira.
    // Antes: Promise.all silenciava o dashboard se /terceiros, /clients ou
    // /documents/list dessem 5xx — user ficava em null e render virava null.
    Promise.allSettled([
      api.get('/auth/me'),
      api.get('/clients'),
      api.get('/terceiros'),
      api.get('/documents/list'),
    ]).then(([meRes, cliRes, tercRes, docsRes]) => {
      if (meRes.status === 'fulfilled') setUser(meRes.value.data.user);
      if (cliRes.status === 'fulfilled') setClientesCount(cliRes.value.data.clients?.length ?? 0);
      if (tercRes.status === 'fulfilled') setTerceirosCount(tercRes.value.data.terceiros?.length ?? 0);
      if (docsRes.status === 'fulfilled') setDocs(docsRes.value.data.documents ?? []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.greeting}>
          <Skeleton width={180} height={24} />
          <div style={{ marginTop: 6 }}><Skeleton width={260} height={13} /></div>
        </div>
        <SkeletonStats count={6} />
      </div>
    );
  }
  if (!user) return null;

  const isIlimitado  = user.plano === 'ilimitado';
  const docPercent   = isIlimitado ? 0 : Math.min((user.documentos_usados / user.limite_documentos) * 100, 100);
  const docsRestantes = isIlimitado ? null : user.limite_documentos - user.documentos_usados;
  const monthlyData  = buildMonthlyData(docs);
  const tipoData     = buildTipoData(docs);
  const tipoMaisUsado = [...tipoData].sort((a, b) => b.value - a.value)[0];
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const docsMes      = docs.filter(d => d.created_at.slice(0, 7) === thisMonthKey).length;
  const diasAtivo    = user.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000)
    : 0;

  const tipoMaisUsadoEntry = tipoMaisUsado
    ? Object.entries(TIPO_LABEL).find(([, v]) => v === tipoMaisUsado.name)
    : null;

  return (
    <div className={styles.page}>

      <div className={styles.greeting}>
        <h1 className={styles.greetingTitle}>Olá, {firstName(user.nome, user.email)}</h1>
        <p className={styles.greetingEmail}>
          {user.email} · <span className={styles.planTag}>{formatPlanName(user.plano)}</span>
        </p>
      </div>

      {/* STATS */}
      <div className={styles.statsGrid}>
        <StatCard icon={FileText} value={docs.length} label="Documentos gerados" sub="Total histórico" />
        <StatCard
          icon={CalendarDays}
          value={isIlimitado ? docsMes : `${docsMes} / ${user.limite_documentos}`}
          label="Documentos este mês"
          sub={docsRestantes !== null ? `${docsRestantes} restante${docsRestantes !== 1 ? 's' : ''}` : 'Uso ilimitado'}
          barPercent={isIlimitado ? undefined : docPercent}
          barDanger={docPercent >= 90}
        />
        <StatCard icon={Users} value={clientesCount} label="Clientes cadastrados" href="/clientes" />
        <StatCard icon={Handshake} value={terceirosCount} label="Terceiros cadastrados" href="/terceiros" />
        <StatCard
          icon={CalendarClock}
          value={diasAtivo}
          label="Dias na plataforma"
          sub={`Desde ${fmtDateBR(user.created_at)}`}
        />
        {tipoMaisUsado && (
          <StatCard
            icon={tipoMaisUsadoEntry ? TIPO_ICON[tipoMaisUsadoEntry[0]] : FileText}
            value={tipoMaisUsado.value}
            label="Tipo mais gerado"
            sub={tipoMaisUsado.name}
          />
        )}
      </div>

      {/* GRÁFICOS */}
      {docs.length > 0 && (
        <div className={styles.chartsRow}>
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
          <div className={styles.chartCard}>
            <h2 className={styles.chartTitle}>Documentos por tipo</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={tipoData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {tipoData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Legend formatter={(v) => <span style={{ fontSize: 12, color: '#94a3b8' }}>{v}</span>} iconType="circle" iconSize={8} />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={((v: any) => [`${Number(v ?? 0)} doc${Number(v) !== 1 ? 's' : ''}`, '']) as any} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ATALHOS */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Gerar novo documento</h2>
        <div className={styles.quickGrid}>
          {Object.entries(TIPO_LABEL).map(([tipo, label]) => {
            const Icon = TIPO_ICON[tipo] ?? FileText;
            return (
              <Link key={tipo} href={TIPO_HREF[tipo]} className={styles.quickCard}>
                <span className={styles.quickIcon}><Icon size={22} strokeWidth={1.6} /></span>
                <span className={styles.quickLabel}>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* HISTÓRICO */}
      {docs.length > 0 ? (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Histórico de documentos</h2>
          <div className={styles.histTable}>
            <div className={styles.histHeader}>
              <span>Documento</span>
              <span>Cliente / Terceiro</span>
              <span>Data</span>
            </div>
            {docs.slice(0, 10).map(doc => {
              const Icon = TIPO_ICON[doc.tipo] ?? FileText;
              return (
                <div key={doc.id} className={styles.histRow}>
                  <div className={styles.histTipo}>
                    <Icon size={16} strokeWidth={1.7} />
                    <span>{TIPO_LABEL[doc.tipo] ?? doc.tipo}</span>
                  </div>
                  <span className={styles.histCliente}>{doc.cliente_nome ?? '—'}</span>
                  <span className={styles.histDate}>{fmtDateBR(doc.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles.emptyState}>
          <Sun size={40} strokeWidth={1.4} />
          <p>Nenhum documento gerado ainda. Comece agora!</p>
        </div>
      )}

    </div>
  );
}
