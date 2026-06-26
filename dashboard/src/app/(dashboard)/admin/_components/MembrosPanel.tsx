'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '@/services/api';
import styles from '../admin.module.css';
import { fmtDateBR, daysDiffBR } from '@/utils/brasilia';

/* ─── tipos (espelham o que GET /admin/users devolve) ───────────── */
interface MemberRow {
  id: string;
  email: string;
  plano: string;                 // free | pro | ilimitado
  documentos_usados: number;
  limite_documentos: number;
  created_at: string;
  is_admin?: boolean;
  whatsapp?: string | null;
  followup_started_at?: string | null;
  empresa_nome?: string | null;
  empresa_cnpj?: string | null;
  empresa_whatsapp?: string | null;
  stripe_status?: string | null; // trialing | active | canceled | past_due | ...
  stripe_plan?: string | null;
  docs_gerados?: number;                 // total real de docs gerados (não reseta)
  followup_toques?: number;              // quantos toques de follow-up já recebeu
  temperatura?: 'quente' | 'morno' | 'frio' | null; // só free: alvo de conversão
}
interface CalcUso { aberturas: number; calculos: number; clientes: number; }
interface UsersResponse { users: MemberRow[]; documents: Array<{ created_at: string }>; calculadora?: CalcUso; }

/* ─── helpers ───────────────────────────────────────────────────── */
const PLANO_LABEL: Record<string, string> = { free: 'FREE', pro: 'PRO', ilimitado: 'VIP' };
const PLANO_COLOR: Record<string, string> = { free: '#64748b', pro: '#64748b', ilimitado: '#64748b' };

// Tradução amigável do status do Stripe. Trial e ativo = receita viva; o resto sinaliza atrito.
const STRIPE_LABEL: Record<string, string> = {
  trialing:           'Em trial',
  active:             'Ativo',
  past_due:           'Pagamento atrasado',
  canceled:           'Cancelado',
  unpaid:             'Não pago',
  incomplete:         'Checkout incompleto',
  incomplete_expired: 'Checkout expirou',
  paused:             'Pausado',
};
const STRIPE_COLOR: Record<string, string> = {
  trialing:           'var(--color-text)',
  active:             'var(--color-text)',
  past_due:           'var(--color-text-muted)',
  canceled:           'var(--color-text-muted)',
  unpaid:             'var(--color-text-muted)',
  incomplete:         'var(--color-text-muted)',
  incomplete_expired: 'var(--color-text-muted)',
  paused:             'var(--color-text-muted)',
};

function relDateShort(d: string) {
  const diff = daysDiffBR(d);
  if (diff === 0) return { label: 'HOJE',  color: 'var(--color-text)' };
  if (diff === 1) return { label: 'ONTEM', color: 'var(--color-text)' };
  if (diff <= 7)  return { label: `${diff} DIAS`, color: 'var(--color-text-muted)' };
  return { label: fmtDateBR(d), color: 'var(--color-text-muted)' };
}
function fmtWhats(w?: string | null) {
  if (!w) return null;
  const d = w.replace(/\D/g, '');
  return d || null;
}

// Temperatura de conversão (só free). 🔥 quente = 3+ docs (alvo forte de upgrade).
const TEMP_META: Record<'quente' | 'morno' | 'frio', { emoji: string; label: string }> = {
  quente: { emoji: '🔥', label: 'Quente' },
  morno:  { emoji: '🟡', label: 'Morno' },
  frio:   { emoji: '❄️', label: 'Frio' },
};

type PlanFilter = 'todos' | 'free' | 'pro' | 'ilimitado';

export default function MembrosPanel() {
  const [data, setData]       = useState<MemberRow[] | null>(null);
  const [calc, setCalc]       = useState<CalcUso | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [q, setQ]             = useState('');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('todos');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<UsersResponse>('/admin/users');
      setData(data.users ?? []);
      setCalc(data.calculadora ?? null);
    } catch {
      setError('Erro ao carregar membros. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const all = data ?? [];

  // KPIs de topo
  const kpis = useMemo(() => {
    const total   = all.length;
    const pro     = all.filter(u => u.plano === 'pro').length;
    const vip     = all.filter(u => u.plano === 'ilimitado').length;
    const free    = all.filter(u => u.plano === 'free').length;
    const trial   = all.filter(u => u.stripe_status === 'trialing').length;
    const ativos  = all.filter(u => u.stripe_status === 'active').length;
    const churn   = all.filter(u => ['canceled', 'unpaid', 'past_due'].includes(u.stripe_status || '')).length;
    return { total, pro, vip, free, trial, ativos, churn };
  }, [all]);

  // Filtro + busca
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = all.filter(u => {
      if (planFilter !== 'todos' && u.plano !== planFilter) return false;
      if (!needle) return true;
      return (
        u.email.toLowerCase().includes(needle) ||
        (u.empresa_nome || '').toLowerCase().includes(needle) ||
        (u.empresa_cnpj || '').toLowerCase().includes(needle) ||
        (u.whatsapp || '').includes(needle) ||
        (u.empresa_whatsapp || '').includes(needle)
      );
    });
    // No filtro FREE, joga os QUENTES (alvo de conversão) pro topo — mais docs primeiro.
    if (planFilter === 'free') {
      const peso = { quente: 3, morno: 2, frio: 1 } as const;
      return [...filtered].sort((a, b) => {
        const pa = peso[a.temperatura ?? 'frio'] ?? 1;
        const pb = peso[b.temperatura ?? 'frio'] ?? 1;
        if (pa !== pb) return pb - pa;
        return (b.docs_gerados ?? 0) - (a.docs_gerados ?? 0);
      });
    }
    return filtered;
  }, [all, q, planFilter]);

  return (
    <>
      <div className={styles.filters} style={{ marginTop: 16, marginBottom: 24, alignItems: 'center', background: 'var(--color-bg-elevated)', padding: '12px 16px', borderRadius: 8, gap: 12, flexWrap: 'wrap' }}>
        <div className={styles.periodTabs}>
          {(['todos', 'free', 'pro', 'ilimitado'] as const).map(p => (
            <button
              key={p}
              className={planFilter === p ? styles.periodActive : styles.periodBtn}
              onClick={() => setPlanFilter(p)}
              disabled={loading}
            >
              {p === 'todos' ? 'Todos' : PLANO_LABEL[p]}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por email, empresa, CNPJ ou WhatsApp…"
          style={{
            flex: '1 1 280px', minWidth: 220, padding: '8px 12px', fontSize: 13,
            borderRadius: 8, border: '1px solid var(--color-border)',
            background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit',
          }}
        />
        <button className="btn-secondary" disabled={loading} onClick={load}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
          {rows.length} de {all.length} membros
        </span>
      </div>

      {error && (
        <div style={{ padding: 24, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>Carregando membros…</div>
      ) : all.length === 0 ? (
        <div className={styles.loading} style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum membro cadastrado ainda</div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className={styles.cards} style={{ gridTemplateColumns: 'repeat(5,1fr)', marginTop: 12 }}>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Total de membros</div>
              <div className={styles.cardValue} style={{ color: 'var(--color-primary)' }}>{kpis.total}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>PRO / VIP</div>
              <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{kpis.pro} <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>/ {kpis.vip}</span></div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>FREE</div>
              <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{kpis.free}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Stripe: trial · ativo · churn</div>
              <div className={styles.cardValue} style={{ fontSize: 20 }}>
                <span style={{ color: 'var(--color-text)' }}>{kpis.trial}</span>
                <span style={{ color: 'var(--color-text-muted)' }}> · </span>
                <span style={{ color: 'var(--color-text)' }}>{kpis.ativos}</span>
                <span style={{ color: 'var(--color-text-muted)' }}> · </span>
                <span style={{ color: 'var(--color-text-muted)' }}>{kpis.churn}</span>
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>🧮 Calculadora (BETA) · abriu · calculou</div>
              <div className={styles.cardValue} style={{ fontSize: 20 }}>
                <span style={{ color: 'var(--color-primary)' }}>{calc?.aberturas ?? 0}</span>
                <span style={{ color: 'var(--color-text-muted)' }}> · </span>
                <span style={{ color: 'var(--color-text)' }}>{calc?.calculos ?? 0}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}> · {calc?.clientes ?? 0} clientes</span>
              </div>
            </div>
          </div>

          {/* Tabela de membros */}
          <div className={styles.tableWrap} style={{ marginTop: 24 }}>
            <table className={styles.table}>
              <thead><tr>
                <th>Membro</th>
                <th>Empresa</th>
                <th>Plano</th>
                <th>Stripe</th>
                <th>Docs</th>
                <th>Temperatura</th>
                <th>Follow-ups</th>
                <th>WhatsApp</th>
                <th>Cadastro</th>
              </tr></thead>
              <tbody>
                {rows.map(u => {
                  const r = relDateShort(u.created_at);
                  const whats = fmtWhats(u.whatsapp) || fmtWhats(u.empresa_whatsapp);
                  const stripeLabel = u.stripe_status ? (STRIPE_LABEL[u.stripe_status] ?? u.stripe_status) : null;
                  const stripeColor = u.stripe_status ? (STRIPE_COLOR[u.stripe_status] ?? 'var(--color-text-muted)') : 'var(--color-text-muted)';
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontWeight: 600 }}>
                            {u.email}{u.is_admin && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: 'var(--color-text-muted)' }}>ADMIN</span>}
                          </span>
                        </div>
                      </td>
                      <td className={styles.mutedCell}>
                        {u.empresa_nome
                          ? <span title={u.empresa_cnpj || ''} style={{ fontWeight: 600 }}>{u.empresa_nome}</span>
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                      <td>
                        <span className={styles.planTag} style={{
                          background: (PLANO_COLOR[u.plano] || '#64748b') + '22',
                          color: PLANO_COLOR[u.plano] || '#64748b',
                          borderColor: (PLANO_COLOR[u.plano] || '#64748b') + '55',
                        }}>
                          {PLANO_LABEL[u.plano] ?? u.plano}
                        </span>
                      </td>
                      <td className={styles.mutedCell}>
                        {stripeLabel
                          ? <span style={{ color: stripeColor, fontWeight: 700 }}>{stripeLabel}</span>
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                      <td className={styles.mutedCell}>
                        {u.documentos_usados}<span style={{ color: 'var(--color-text-muted)' }}>/{u.plano === 'ilimitado' || u.limite_documentos >= 999999 ? '∞' : u.limite_documentos}</span>
                        {typeof u.docs_gerados === 'number' && u.docs_gerados !== u.documentos_usados && (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }} title="Total de documentos já gerados (não reseta no mês)"> · {u.docs_gerados} total</span>
                        )}
                      </td>
                      <td className={styles.mutedCell}>
                        {u.temperatura
                          ? <span title={`${TEMP_META[u.temperatura].label} — ${u.docs_gerados ?? 0} docs gerados`} style={{ fontWeight: 700, color: 'var(--color-text)' }}>
                              {TEMP_META[u.temperatura].emoji} {TEMP_META[u.temperatura].label}
                            </span>
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                      <td className={styles.mutedCell}>
                        {u.followup_toques && u.followup_toques > 0
                          ? <span title="Toques de follow-up já enviados (todas as cadências somadas)" style={{ fontWeight: 600 }}>{u.followup_toques}×</span>
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                      <td className={styles.mutedCell}>
                        {whats
                          ? <a href={`https://wa.me/55${whats.replace(/^55/, '')}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>{whats}</a>
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: 12, color: r.color }}>{r.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={9} className={styles.mutedCell} style={{ textAlign: 'center', padding: '24px 8px' }}>
                    Nenhum membro bate com o filtro/busca.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
