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
  followup_toques?: number;              // compat: = toques WhatsApp (canal pausado)
  followup_whatsapp_toques?: number;     // toques WhatsApp Carla (histórico, canal pausado)
  followup_email_last_sent_at?: string | null; // último email de follow-up (canal ATIVO)
  conversa?: { mensagens: ChatMsg[]; atualizada_em: string } | null; // conversa real trocada
  temperatura?: 'quente' | 'morno' | 'frio' | null; // só free: alvo de conversão
}
interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface CalcUso { aberturas: number; calculos: number; clientes: number; }
interface InvUso { aberturas: number; itens: number; clientes: number; }
interface UsersResponse { users: MemberRow[]; documents: Array<{ created_at: string }>; calculadora?: CalcUso; inventario?: InvUso; }

// Recebimento (Stripe) — espelha o payload de GET /admin/billing.
interface ProximaCobranca {
  data: string;
  valor: number;
  produto: string;
  cliente: string | null;
  tipo: 'primeira' | 'renovacao' | 'atrasada';
}
interface BillingResponse {
  // vendas (card-pass = venda) — batem 1:1 com a Stripe
  vendas: number;
  vendas_por_produto: { PRO: number; VIP: number; 'VIP PROMO': number };
  past_due: number;
  proximas_cobrancas: ProximaCobranca[];
  checkouts_abandonados?: number;
  checkouts_recuperados?: number;
  // caixa (dinheiro que entrou)
  recebido_total: number;
  recebido_mes: number;
  previsao_mes: number;
  previsao_proximo_mes: number;
  mrr_ativo: number;
  trial_upside: number;
  assinaturas_ativas: number;
  trials: number;
  moeda: 'BRL';
  atualizado_em: string;
}

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

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
const TEMP_META: Record<'quente' | 'morno' | 'frio', { label: string }> = {
  quente: { label: 'Quente' },
  morno:  { label: 'Morno' },
  frio:   { label: 'Frio' },
};

type PlanFilter = 'todos' | 'free' | 'pro' | 'ilimitado';

export default function MembrosPanel() {
  const [data, setData]       = useState<MemberRow[] | null>(null);
  const [calc, setCalc]       = useState<CalcUso | null>(null);
  const [inv, setInv]         = useState<InvUso | null>(null);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [q, setQ]             = useState('');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('todos');
  // Membro cuja conversa está aberta no modal (null = fechado).
  const [convAberta, setConvAberta] = useState<MemberRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Membros e recebimento em paralelo. O recebimento (Stripe) é mais lento e
      // pode falhar isolado — não derruba a lista de membros se der erro.
      const [usersRes, billingRes] = await Promise.allSettled([
        api.get<UsersResponse>('/admin/users'),
        api.get<BillingResponse>('/admin/billing'),
      ]);
      if (usersRes.status === 'fulfilled') {
        setData(usersRes.value.data.users ?? []);
        setCalc(usersRes.value.data.calculadora ?? null);
        setInv(usersRes.value.data.inventario ?? null);
      } else {
        throw usersRes.reason;
      }
      setBilling(billingRes.status === 'fulfilled' ? billingRes.value.data : null);
    } catch {
      setError('Erro ao carregar membros. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Liberação manual por Pix: cliente pagou por Pix e mandou o comprovante → libera
  // N meses de acesso ilimitado (renova somando ao que resta). Recarrega a lista.
  async function liberarPix(email: string) {
    const mesesStr = window.prompt(`Liberar acesso por Pix pra ${email}\n\nQuantos meses? (comprovante confirmado)`, '1');
    if (mesesStr === null) return;
    const meses = Math.max(1, Math.min(12, parseInt(mesesStr, 10) || 1));
    try {
      const { data: r } = await api.post('/admin/pix-liberar', { email, meses });
      alert(`Liberado! ${email} agora é VIP até ${new Date(r.plano_expira_em).toLocaleDateString('pt-BR')}.`);
      load();
    } catch {
      alert('Falha ao liberar. Tenta de novo.');
    }
  }

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
      <div className={styles.filters} style={{ marginTop: 16, marginBottom: 24, alignItems: 'center', background: 'var(--color-surface-2)', padding: '12px 16px', borderRadius: 8, gap: 12, flexWrap: 'wrap' }}>
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
          {/* VENDAS (cartão passou = venda) — bate 1:1 com a Stripe. É o número principal. */}
          {billing && (
            <>
              <div className={styles.cards} style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 12 }}>
                <div className={styles.card} style={{ borderColor: 'var(--color-primary)', borderWidth: 2, borderStyle: 'solid' }}>
                  <div className={styles.cardLabel}>Vendas (cartão passou)</div>
                  <div className={styles.cardValue} style={{ color: 'var(--color-primary)' }}>{billing.vendas ?? 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Assinantes vivos na Stripe: trial + ativos{(billing.past_due ?? 0) > 0 ? ` + ${billing.past_due} em atraso` : ''}
                  </div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>PRO</div>
                  <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{billing.vendas_por_produto?.PRO ?? 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>R$ 27/mês</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>VIP</div>
                  <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{billing.vendas_por_produto?.VIP ?? 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>R$ 67/mês</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>VIP PROMO</div>
                  <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{billing.vendas_por_produto?.['VIP PROMO'] ?? 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>R$ 49/mês</div>
                </div>
              </div>

              {/* O QUE VAI CAIR NA CONTA — próximas cobranças (fim de trial + renovações) */}
              {(billing.proximas_cobrancas?.length ?? 0) > 0 && (
                <div className={styles.card} style={{ marginTop: 12, padding: '16px 18px' }}>
                  <div className={styles.cardLabel} style={{ marginBottom: 10 }}>
                    O que vai cair na conta — {fmtBRL(billing.proximas_cobrancas.reduce((s, p) => s + p.valor, 0))} em {billing.proximas_cobrancas.length} cobranças previstas
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                    {billing.proximas_cobrancas.map((p, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13, padding: '7px 10px', borderRadius: 8, background: 'rgba(148,163,184,0.10)' }}>
                        <span style={{ minWidth: 88, color: 'var(--color-text-muted)' }}>{fmtDateBR(p.data)}</span>
                        <span style={{ flex: 1, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cliente || '—'}</span>
                        <span style={{ minWidth: 78, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 11 }}>{p.produto}</span>
                        <span style={{ minWidth: 66, textAlign: 'right', fontWeight: 700, color: p.tipo === 'atrasada' ? '#ef4444' : 'var(--color-text)' }}>{fmtBRL(p.valor)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
                    Fim de trial (1ª cobrança) + renovações. Vermelho = atrasada (cartão recusado na renovação).
                  </div>
                </div>
              )}

              {/* RECUPERAÇÃO — quem começou e não passou o cartão */}
              {((billing.checkouts_abandonados ?? 0) > 0 || (billing.checkouts_recuperados ?? 0) > 0) && (
                <div className={styles.cards} style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: 12 }}>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Em recuperação</div>
                    <div className={styles.cardValue} style={{ color: '#f59e0b' }}>{billing.checkouts_abandonados ?? 0}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>Começou e não passou o cartão — recebendo email/WhatsApp pra retomar</div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Recuperados</div>
                    <div className={styles.cardValue} style={{ color: '#22c55e' }}>{billing.checkouts_recuperados ?? 0}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>Abandonaram e depois voltaram a comprar</div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Recebimento (Stripe) — bruto, só assinaturas SolarDoc PRO/VIP */}
          {billing && (
            <div className={styles.cards} style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 12 }}>
              <div className={styles.card} style={{ borderColor: 'var(--color-primary)', borderWidth: 1, borderStyle: 'solid' }}>
                <div className={styles.cardLabel}>Acumulado recebido</div>
                <div className={styles.cardValue} style={{ color: 'var(--color-primary)' }}>{fmtBRL(billing.recebido_total)}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Total já pago no Stripe (bruto, sem taxas) · todas as assinaturas
                </div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Previsão deste mês</div>
                <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{fmtBRL(billing.previsao_mes)}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Recebido no mês ({fmtBRL(billing.recebido_mes)}) + o que ainda fatura até o fim
                </div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>Previsão próximo mês</div>
                <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{fmtBRL(billing.previsao_proximo_mes)}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {billing.assinaturas_ativas} assinatura{billing.assinaturas_ativas === 1 ? '' : 's'} ativa{billing.assinaturas_ativas === 1 ? '' : 's'}
                  {billing.trial_upside > 0 && <> · +{fmtBRL(billing.trial_upside)} se os {billing.trials} trials converterem</>}
                </div>
              </div>
            </div>
          )}

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
              <div className={styles.cardLabel}>Calculadora (BETA) · abriu · calculou</div>
              <div className={styles.cardValue} style={{ fontSize: 20 }}>
                <span style={{ color: 'var(--color-primary)' }}>{calc?.aberturas ?? 0}</span>
                <span style={{ color: 'var(--color-text-muted)' }}> · </span>
                <span style={{ color: 'var(--color-text)' }}>{calc?.calculos ?? 0}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}> · {calc?.clientes ?? 0} clientes</span>
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Inventário · abriu · itens</div>
              <div className={styles.cardValue} style={{ fontSize: 20 }}>
                <span style={{ color: 'var(--color-primary)' }}>{inv?.aberturas ?? 0}</span>
                <span style={{ color: 'var(--color-text-muted)' }}> · </span>
                <span style={{ color: 'var(--color-text)' }}>{inv?.itens ?? 0}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}> · {inv?.clientes ?? 0} clientes</span>
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
                <th>Pix</th>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontWeight: 600 }}>
                            {u.email}{u.is_admin && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: 'var(--color-text-muted)' }}>ADMIN</span>}
                          </span>
                          {(() => {
                            const n = u.conversa?.mensagens?.length ?? 0;
                            return (
                              <button
                                onClick={() => setConvAberta(u)}
                                title="Ver o histórico completo da conversa no WhatsApp"
                                style={{
                                  alignSelf: 'flex-start', fontSize: 11, fontWeight: 700,
                                  color: n > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                  textDecoration: 'underline', fontFamily: 'inherit',
                                }}>
                                Ver conversa{n > 0 ? ` (${n})` : ''}
                              </button>
                            );
                          })()}
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
                              {TEMP_META[u.temperatura].label}
                            </span>
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                      <td className={styles.mutedCell}>
                        {(() => {
                          const emailAt = u.followup_email_last_sent_at;
                          const wpp = u.followup_whatsapp_toques ?? u.followup_toques ?? 0;
                          const temConversa = !!u.conversa && (u.conversa.mensagens?.length ?? 0) > 0;
                          if (!emailAt && wpp === 0 && !temConversa) return <span className={styles.emptyDash}>—</span>;
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                              {emailAt && (
                                <span title={`Cadência de e-mail (ativa). Último envio: ${fmtDateBR(emailAt)}`}
                                      style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>
                                  E-mail · {relDateShort(emailAt).label}
                                </span>
                              )}
                              {wpp > 0 && (
                                <span title="Toques de WhatsApp da Carla (canal PAUSADO — histórico)"
                                      style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                  WhatsApp {wpp}× <span style={{ fontSize: 10 }}>(pausado)</span>
                                </span>
                              )}
                              {temConversa && (
                                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                  Conversa: {u.conversa!.mensagens.length} msg
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className={styles.mutedCell}>
                        {whats
                          ? <a href={`https://wa.me/55${whats.replace(/^55/, '')}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>{whats}</a>
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: 12, color: r.color }}>{r.label}</span>
                      </td>
                      <td>
                        {/* Pix é SÓ pra quem foi cliente e o cartão parou: recusado
                            (past_due) ou cancelado. NÃO aparece em free (nunca pagou),
                            ativo/trial (cartão ok) nem admin — evita poluição e o risco
                            de liberar VIP grátis por engano num free. */}
                        {(u.stripe_status === 'past_due' || u.stripe_status === 'canceled')
                          ? (
                            <button
                              onClick={() => liberarPix(u.email)}
                              title="Cartão recusado/cancelado → cliente pagou por Pix e mandou o comprovante → liberar acesso"
                              style={{
                                fontSize: 11, fontWeight: 800, color: '#0f172a', background: '#22c55e',
                                border: 'none', borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
                                whiteSpace: 'nowrap', fontFamily: 'inherit',
                              }}>
                              + Pix
                            </button>
                          )
                          : <span className={styles.emptyDash}>—</span>}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={10} className={styles.mutedCell} style={{ textAlign: 'center', padding: '24px 8px' }}>
                    Nenhum membro bate com o filtro/busca.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal: conversa real trocada no WhatsApp com o membro */}
      {convAberta && (
        <div
          onClick={() => setConvAberta(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)',
              width: 'min(560px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>
                  Conversa · {convAberta.empresa_nome || convAberta.email}
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {convAberta.conversa
                    ? `${convAberta.conversa.mensagens.length} mensagens · última ${fmtDateBR(convAberta.conversa.atualizada_em)}`
                    : 'Nenhuma conversa registrada ainda'}
                </span>
              </div>
              <button
                onClick={() => setConvAberta(null)}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--color-text-muted)', lineHeight: 1, fontFamily: 'inherit' }}
                aria-label="Fechar">×</button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {convAberta.conversa ? convAberta.conversa.mensagens.map((m, i) => {
                const isAgente = m.role === 'assistant'; // assistant = nós (Carla/agente)
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: isAgente ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '78%', padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.45,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      background: isAgente ? 'var(--color-primary)' : 'var(--color-surface-2)',
                      color: isAgente ? '#fff' : 'var(--color-text)',
                      borderBottomRightRadius: isAgente ? 3 : 12,
                      borderBottomLeftRadius: isAgente ? 12 : 3,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, marginBottom: 2 }}>
                        {isAgente ? 'SolarDoc' : (convAberta.empresa_nome || 'Cliente')}
                      </div>
                      {/* remove o separador de bolhas || que o agente usa internamente */}
                      {m.content.replace(/\s*\|\|\s*/g, '\n')}
                    </div>
                  </div>
                );
              }) : (
                <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.7 }}>
                  Este cliente ainda não trocou nenhuma mensagem no WhatsApp.<br />
                  Assim que ele conversar com a Giovanna (34998165040), o histórico completo aparece aqui.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
