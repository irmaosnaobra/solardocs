'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '@/services/api';
import styles from '../admin.module.css';
import { fmtDateBR, daysDiffBR } from '@/utils/brasilia';

/* ─── tipos (espelham GET /admin/membros-limpapro) ──────────────── */
interface ProdutoStat {
  slug: string;
  label: string;
  tipo: 'curso' | 'extra' | 'grupo' | 'mentoria';
  donos: number;
  pct: number;
}
interface MembroLp {
  email: string;
  nome: string | null;
  telefone: string | null;
  whatsapp_url: string | null;
  ativo: boolean;
  itens: string[];
  produtos: string[];
  n_extras: number;
  ativou: boolean;      // criou senha
  acessou: boolean;     // já entrou no app
  status: 'acessou' | 'ativou' | 'nao_acessou';
  aulas_concluidas: number;
  completou_principal: boolean;
  criado_em: string | null;
  ultimo_acesso_em: string | null;
}
interface Kpis {
  total: number;
  ativos: number;
  ativaram: number;
  acessaram: number;
  nunca_acessaram: number;
  com_whatsapp: number;
  completaram_principal: number;
  total_extras_vendidos: number;
}
interface MembrosLpData {
  gerado_em: string;
  kpis: Kpis;
  produtos: ProdutoStat[];
  membros: MembroLp[];
}

/* ─── helpers ───────────────────────────────────────────────────── */
function relDateShort(d: string | null) {
  if (!d) return { label: '—', color: 'var(--color-text-muted)' };
  const diff = daysDiffBR(d);
  if (diff === 0) return { label: 'HOJE', color: 'var(--color-text)' };
  if (diff === 1) return { label: 'ONTEM', color: 'var(--color-text)' };
  if (diff <= 7) return { label: `${diff} DIAS`, color: 'var(--color-text-muted)' };
  return { label: fmtDateBR(d), color: 'var(--color-text-muted)' };
}
function pct(n: number, total: number) { return !total ? '—' : `${Math.round((n / total) * 100)}%`; }

// Mensagem de WhatsApp pré-preenchida. Pra quem nunca entrou = convite pra acessar
// (o alvo do "avisar os clientes"); pra quem já entrou = só abre a conversa.
function waLink(m: MembroLp): string | null {
  if (!m.whatsapp_url) return null;
  const primeiro = (m.nome || '').trim().split(/\s+/)[0];
  const saud = primeiro ? `Oi ${primeiro}!` : 'Oi!';
  if (m.acessou) return m.whatsapp_url;
  const msg =
    `${saud} Tudo bem? 🎉 Sua Área de Membros do *LimpaPro* já está no ar. ` +
    `É só acessar https://limpapro.solardoc.app/membros com seu e-mail (${m.email}) e criar sua senha de acesso. ` +
    `Qualquer dúvida, é só chamar aqui! ☀️`;
  return `${m.whatsapp_url}?text=${encodeURIComponent(msg)}`;
}

type Filtro = 'todos' | 'nao_acessou' | 'acessou' | 'extras';

const STATUS_META: Record<MembroLp['status'], { label: string; fg: string; bg: string; bd: string }> = {
  acessou:     { label: 'Já entrou',      fg: 'var(--ink-green, #16a34a)', bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.30)' },
  ativou:      { label: 'Criou senha',    fg: 'var(--color-text)',         bg: 'var(--color-surface-2)', bd: 'var(--color-border)' },
  nao_acessou: { label: 'Não acessou',    fg: 'var(--ink-amber, #d97706)', bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.30)' },
};

// Cor da barra por tipo de produto (curso = acento; extras neutros; mentoria destaque).
function barColor(tipo: ProdutoStat['tipo']) {
  return tipo === 'curso' ? 'var(--color-primary)'
    : tipo === 'mentoria' ? 'var(--ink-amber, #d97706)'
    : 'var(--color-text-muted)';
}

export default function MembrosLimpaproPanel() {
  const [data, setData] = useState<MembrosLpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<MembrosLpData>('/admin/membros-limpapro');
      setData(data);
    } catch {
      setError('Erro ao carregar membros do LimpaPro. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = data?.kpis;
  const membros = useMemo(() => data?.membros ?? [], [data]);
  const produtos = data?.produtos ?? [];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return membros.filter(m => {
      if (filtro === 'nao_acessou' && m.acessou) return false;
      if (filtro === 'acessou' && !m.acessou) return false;
      if (filtro === 'extras' && m.n_extras === 0) return false;
      if (!needle) return true;
      return (
        m.email.toLowerCase().includes(needle) ||
        (m.nome || '').toLowerCase().includes(needle) ||
        (m.telefone || '').includes(needle)
      );
    });
  }, [membros, q, filtro]);

  const FILTROS: { value: Filtro; label: string }[] = [
    { value: 'todos', label: 'Todos' },
    { value: 'nao_acessou', label: 'Não acessaram' },
    { value: 'acessou', label: 'Já entraram' },
    { value: 'extras', label: 'Com extras' },
  ];

  return (
    <>
      {/* Barra: filtros + busca + atualizar */}
      <div className={styles.filters} style={{ marginTop: 16, marginBottom: 24, alignItems: 'center', background: 'var(--color-surface-2)', padding: '12px 16px', borderRadius: 8, gap: 12, flexWrap: 'wrap' }}>
        <div className={styles.periodTabs}>
          {FILTROS.map(f => (
            <button
              key={f.value}
              className={filtro === f.value ? styles.periodActive : styles.periodBtn}
              onClick={() => setFiltro(f.value)}
              disabled={loading}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nome, e-mail ou WhatsApp…"
          style={{
            flex: '1 1 260px', minWidth: 200, padding: '8px 12px', fontSize: 13,
            borderRadius: 8, border: '1px solid var(--color-border)',
            background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit',
          }}
        />
        <button className="btn-secondary" disabled={loading} onClick={load}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
          {rows.length} de {membros.length} membros
        </span>
      </div>

      {error && (
        <div style={{ padding: 24, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>Carregando membros…</div>
      ) : !kpis || kpis.total === 0 ? (
        <div className={styles.loading} style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum comprador na área de membros ainda</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Assim que alguém comprar o curso na Kiwify, ele aparece aqui automaticamente.
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — o retrato honesto de hoje */}
          <div className={styles.cards} style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 4 }}>
            <div className={styles.card} style={{ borderColor: 'var(--color-primary)', borderWidth: 2, borderStyle: 'solid' }}>
              <div className={styles.cardLabel}>Compradores com acesso</div>
              <div className={styles.cardValue} style={{ color: 'var(--color-primary)' }}>{kpis.total}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                todos têm o curso principal liberado
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Já entraram no app ({pct(kpis.acessaram, kpis.total)})</div>
              <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{kpis.acessaram}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {kpis.ativaram} criaram senha
              </div>
            </div>
            <div className={styles.card} style={{ borderColor: kpis.nunca_acessaram > 0 ? 'rgba(245,158,11,0.45)' : undefined, borderWidth: kpis.nunca_acessaram > 0 ? 1 : undefined, borderStyle: kpis.nunca_acessaram > 0 ? 'solid' : undefined }}>
              <div className={styles.cardLabel}>Ainda não acessaram</div>
              <div className={styles.cardValue} style={{ color: kpis.nunca_acessaram > 0 ? 'var(--ink-amber, #d97706)' : 'var(--color-text)' }}>{kpis.nunca_acessaram}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                avise pelo WhatsApp (aba “Não acessaram”)
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Extras vendidos</div>
              <div className={styles.cardValue} style={{ color: 'var(--color-text)' }}>{kpis.total_extras_vendidos}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                order-bumps além do curso principal
              </div>
            </div>
          </div>

          {/* SEÇÃO 1 — O que o público compra (attach rate). O dado real de hoje. */}
          <div style={{ marginTop: 28 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>O que o público compra</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
              De cada 100 compradores, quantos levam cada produto. É o comportamento de compra da sua base hoje.
            </p>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '8px 4px' }}>
              {produtos.map((p, i) => (
                <div key={p.slug} style={{
                  display: 'grid', gridTemplateColumns: '180px 1fr 96px', gap: 14, alignItems: 'center',
                  padding: '11px 16px', borderBottom: i < produtos.length - 1 ? '1px solid var(--color-border)' : 0,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.label}
                    {p.tipo === 'mentoria' && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-amber, #d97706)', letterSpacing: '0.04em' }}>ALTO TICKET</span>}
                  </div>
                  {/* Barra */}
                  <div style={{ background: 'var(--color-surface-2)', borderRadius: 999, height: 12, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.max(p.pct, p.donos > 0 ? 3 : 0)}%`, height: '100%',
                      background: barColor(p.tipo), borderRadius: 999, transition: 'width .4s ease',
                    }} />
                  </div>
                  {/* Números */}
                  <div style={{ textAlign: 'right', fontSize: 13 }}>
                    <span style={{ fontWeight: 800 }}>{p.donos}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}> · {p.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
              Base: quem já está na área de membros. <b>Mentoria</b> não é order-bump — é venda direta de alto ticket;
              zero aqui é esperado até a primeira. O attach rate mostra qual extra convém empurrar mais no funil.
            </div>
          </div>

          {/* SEÇÃO 2 — Tabela de membros (ativação + engajamento). */}
          <div style={{ marginTop: 32, marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Base de membros</h3>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              filtre por “Não acessaram” pra avisar quem ainda não entrou
            </span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr>
                <th>Membro</th>
                <th>Produtos</th>
                <th>Progresso</th>
                <th>Situação</th>
                <th>Compra</th>
                <th>WhatsApp</th>
              </tr></thead>
              <tbody>
                {rows.map(m => {
                  const st = STATUS_META[m.status];
                  const wa = waLink(m);
                  const cad = relDateShort(m.criado_em);
                  return (
                    <tr key={m.email}>
                      {/* Membro */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontWeight: 600 }}>{m.nome || '(sem nome)'}</span>
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{m.email}</span>
                        </div>
                      </td>
                      {/* Produtos */}
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 260 }}>
                          {m.produtos.map(p => (
                            <span key={p} className={styles.planTag} style={{
                              background: 'var(--color-surface-2)', color: 'var(--color-text-muted)',
                              borderColor: 'var(--color-border)', fontSize: 10,
                            }}>{p}</span>
                          ))}
                        </div>
                      </td>
                      {/* Progresso */}
                      <td className={styles.mutedCell}>
                        {m.completou_principal ? (
                          <span style={{ color: 'var(--ink-green, #16a34a)', fontWeight: 700 }}>Concluiu o principal</span>
                        ) : m.aulas_concluidas > 0 ? (
                          <span>{m.aulas_concluidas} aula{m.aulas_concluidas === 1 ? '' : 's'} concluída{m.aulas_concluidas === 1 ? '' : 's'}</span>
                        ) : (
                          <span className={styles.emptyDash}>—</span>
                        )}
                      </td>
                      {/* Situação (ativação) */}
                      <td>
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                          background: st.bg, color: st.fg, border: `1px solid ${st.bd}`,
                        }}>{st.label}</span>
                        {m.acessou && m.ultimo_acesso_em && (
                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3 }}>
                            último {relDateShort(m.ultimo_acesso_em).label.toLowerCase()}
                          </div>
                        )}
                      </td>
                      {/* Compra (cadastro) */}
                      <td>
                        <span style={{ fontWeight: 600, fontSize: 12, color: cad.color }}>{cad.label}</span>
                      </td>
                      {/* WhatsApp */}
                      <td>
                        {wa ? (
                          <a href={wa} target="_blank" rel="noopener noreferrer" style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
                            padding: '6px 12px', borderRadius: 8, textDecoration: 'none',
                            background: m.acessou ? 'var(--color-surface-2)' : 'rgba(16,185,129,0.12)',
                            color: m.acessou ? 'var(--color-text-muted)' : 'var(--ink-green, #16a34a)',
                            border: `1px solid ${m.acessou ? 'var(--color-border)' : 'rgba(16,185,129,0.3)'}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {m.acessou ? 'Abrir' : 'Avisar'}
                          </a>
                        ) : (
                          <span className={styles.emptyDash}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className={styles.mutedCell} style={{ textAlign: 'center', padding: '24px 8px' }}>
                    Nenhum membro bate com o filtro/busca.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Nota de rodapé — como ler + de onde vem */}
          <div style={{ marginTop: 24, padding: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--color-text)' }}>Como ler:</strong> cada linha é um comprador do curso com acesso à
            área de membros (<code style={{ padding: '0 4px' }}>limpapro.solardoc.app/membros</code>). <b>Situação</b> mostra a
            ativação: <b>Não acessou</b> (nunca abriu — avise), <b>Criou senha</b> (configurou a conta) ou <b>Já entrou</b>.
            <b> Progresso</b> conta as aulas marcadas como concluídas no app — enche conforme a galera estuda.
            <br /><br />
            <strong style={{ color: 'var(--color-text)' }}>De onde vem:</strong> compra e produtos vêm do webhook da Kiwify
            (provisiona o acesso na hora); acesso e progresso vêm do próprio app. O botão <b>Avisar</b> abre o WhatsApp já com
            a mensagem de convite pra quem ainda não entrou.
          </div>
        </>
      )}
    </>
  );
}
