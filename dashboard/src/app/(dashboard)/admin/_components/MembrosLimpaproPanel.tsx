'use client';

import { Fragment, useEffect, useState, useCallback, useMemo, type CSSProperties } from 'react';
import api from '@/services/api';
import styles from '../admin.module.css';
import { fmtDateBR, daysDiffBR } from '@/utils/brasilia';

/* ─── tipos (espelham GET /admin/membros-limpapro) ──────────────── */
interface JornadaStep { key: string; label: string; value: number }
interface Engaj { slug: string; label: string; bonus: boolean; feitos: number; base: number; pct: number }
interface ProdutoStat { slug: string; label: string; tipo: 'curso' | 'plano' | 'extra' | 'grupo' | 'mentoria'; donos: number; pct: number }
interface MembroLp {
  email: string;
  nome: string | null;
  telefone: string | null;
  whatsapp_url: string | null;
  ativo: boolean;
  premium: boolean;
  plano: 'completo' | 'basico';
  itens: string[];
  produtos: string[];
  n_extras: number;
  criou_senha: boolean;
  acessou: boolean;
  status: 'acessou' | 'ativou' | 'nao_acessou';
  modulos_feitos: string[];
  n_modulos: number;
  completou_curso: boolean;
  bonus_feitos: string[];
  certificado: 'liberado' | 'em_andamento' | 'bloqueado';
  aulas_concluidas: number;
  criado_em: string | null;
  atualizado_em: string | null;
  ultimo_acesso_em: string | null;
}
interface Kpis {
  total: number; completo: number; basico: number;
  acessaram: number; criaram_senha: number; concluiram_curso: number;
  certificados: number; nunca_acessaram: number; com_whatsapp: number; total_extras_vendidos: number;
}
interface CliqueAlvo { alvo: string; n: number }
interface CliquesApp { total: number; aulas: CliqueAlvo[]; ofertas: CliqueAlvo[]; checkouts: CliqueAlvo[] }
interface VendaAtividade { email: string; nome: string | null; produto: string; tipo: string; comprou: boolean; valor: number; criado_em: string }
interface VendasInternas { hoje_valor: number; total_valor: number; total_qtd: number; checkouts: number; convertidos: number; conversao_pct: number; atividade: VendaAtividade[] }
interface MembrosLpData {
  gerado_em: string;
  kpis: Kpis;
  jornada: JornadaStep[];
  engajamento: Engaj[];
  produtos: ProdutoStat[];
  cliques_app?: CliquesApp;
  vendas_internas?: VendasInternas;
  membros: MembroLp[];
}

/* ─── constantes de exibição (espelham o app) ───────────────────── */
const MODS = [
  { slug: 'm01', n: '1', label: 'Técnica de Limpeza' },
  { slug: 'm02', n: '2', label: 'Segurança em Altura' },
  { slug: 'm03', n: '3', label: 'Precificação' },
  { slug: 'm04', n: '4', label: 'Captação de Clientes' },
  { slug: 'm05', n: '5', label: 'Renda Recorrente' },
];
const BONS = [
  { slug: 'scripts', label: 'Scripts de WhatsApp' },
  { slug: 'b00', label: 'Tabela de Precificação' },
];

/* ─── helpers ───────────────────────────────────────────────────── */
function relDateShort(d: string | null) {
  if (!d) return { label: '—', color: 'var(--color-text-muted)' };
  const diff = daysDiffBR(d);
  if (diff === 0) return { label: 'HOJE', color: 'var(--color-text)' };
  if (diff === 1) return { label: 'ONTEM', color: 'var(--color-text)' };
  if (diff <= 7) return { label: `${diff} DIAS`, color: 'var(--color-text-muted)' };
  return { label: fmtDateBR(d), color: 'var(--color-text-muted)' };
}
const pct = (n: number, total: number) => (!total ? '—' : `${Math.round((n / total) * 100)}%`);
const brl = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// Rótulo amigável do alvo de clique ('main:m01' → 'Técnica de Limpeza'; 'usina' → 'Usina de Grande Porte').
const OFERTA_LABELS: Record<string, string> = {
  usina: 'Usina de Grande Porte', mentoria: 'Mentoria', 'kit-captacao': 'Kit Captação',
  comunidade: 'Comunidade +Sol', fidelidade: 'Contrato Recorrente', 'kit-equipamento': 'Kit de Equipamento',
};
function labelAlvo(alvo: string): string {
  const slug = alvo.includes(':') ? alvo.split(':')[1] : alvo;
  const mod = MODS.find(m => m.slug === slug) || BONS.find(b => b.slug === slug);
  return mod ? mod.label : (OFERTA_LABELS[slug] || slug);
}

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

type Filtro = 'todos' | 'completo' | 'basico' | 'nao_acessou' | 'concluiram';

const CERT_META: Record<MembroLp['certificado'], { label: string; fg: string; bg: string; bd: string }> = {
  liberado:     { label: 'Liberado',     fg: 'var(--ink-green, #16a34a)', bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.30)' },
  em_andamento: { label: 'Em andamento', fg: 'var(--ink-amber, #d97706)', bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.30)' },
  bloqueado:    { label: 'Só no Completo', fg: 'var(--color-text-muted)', bg: 'var(--color-surface-2)', bd: 'var(--color-border)' },
};

function barColor(tipo: ProdutoStat['tipo']) {
  return tipo === 'curso' || tipo === 'plano' ? 'var(--color-primary)'
    : tipo === 'mentoria' ? 'var(--ink-amber, #d97706)'
    : 'var(--color-text-muted)';
}

/* dot de módulo (verde = concluído) */
function ModDot({ done, n, title }: { done: boolean; n: string; title: string }) {
  return (
    <span title={title} style={{
      display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: 6,
      fontSize: 11, fontWeight: 800,
      background: done ? 'rgba(16,185,129,0.16)' : 'var(--color-surface-2)',
      color: done ? 'var(--ink-green, #16a34a)' : 'var(--color-text-muted)',
      border: `1px solid ${done ? 'rgba(16,185,129,0.4)' : 'var(--color-border)'}`,
    }}>{done ? '✓' : n}</span>
  );
}

export default function MembrosLimpaproPanel() {
  const [data, setData] = useState<MembrosLpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [aberto, setAberto] = useState<string | null>(null); // email do membro expandido

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get<MembrosLpData>('/admin/membros-limpapro');
      setData(data);
    } catch { setError('Erro ao carregar membros do LimpaPro. Tenta de novo.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const kpis = data?.kpis;
  const membros = useMemo(() => data?.membros ?? [], [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return membros.filter(m => {
      if (filtro === 'completo' && !m.premium) return false;
      if (filtro === 'basico' && m.premium) return false;
      if (filtro === 'nao_acessou' && m.acessou) return false;
      if (filtro === 'concluiram' && !m.completou_curso) return false;
      if (!needle) return true;
      return m.email.toLowerCase().includes(needle) || (m.nome || '').toLowerCase().includes(needle) || (m.telefone || '').includes(needle);
    });
  }, [membros, q, filtro]);

  const FILTROS: { value: Filtro; label: string }[] = [
    { value: 'todos', label: 'Todos' },
    { value: 'completo', label: 'Completo' },
    { value: 'basico', label: 'Básico' },
    { value: 'nao_acessou', label: 'Não acessaram' },
    { value: 'concluiram', label: 'Concluíram' },
  ];

  return (
    <>
      {/* Barra: filtros + busca + atualizar */}
      <div className={styles.filters} style={{ marginTop: 16, marginBottom: 24, alignItems: 'center', background: 'var(--color-surface-2)', padding: '12px 16px', borderRadius: 8, gap: 12, flexWrap: 'wrap' }}>
        <div className={styles.periodTabs}>
          {FILTROS.map(f => (
            <button key={f.value} className={filtro === f.value ? styles.periodActive : styles.periodBtn} onClick={() => setFiltro(f.value)} disabled={loading}>{f.label}</button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome, e-mail ou WhatsApp…"
          style={{ flex: '1 1 240px', minWidth: 190, padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit' }} />
        <button className="btn-secondary" disabled={loading} onClick={load}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>{rows.length} de {membros.length} membros</span>
      </div>

      {error && <div style={{ padding: 24, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Carregando membros…</div>
      ) : !kpis || kpis.total === 0 ? (
        <div className={styles.loading} style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum comprador na área de membros ainda</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Assim que alguém comprar o curso na Kiwify, ele aparece aqui automaticamente.</div>
        </div>
      ) : (
        <>
          {/* ═══ KPIs ═══ */}
          <div className={styles.cards} style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 4 }}>
            <div className={styles.card} style={{ borderColor: 'var(--color-primary)', borderWidth: 2, borderStyle: 'solid' }}>
              <div className={styles.cardLabel}>Membros com acesso</div>
              <div className={styles.cardValue} style={{ color: 'var(--color-primary)' }}>{kpis.total}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{kpis.completo} Completo · {kpis.basico} Básico</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Já entraram no app ({pct(kpis.acessaram, kpis.total)})</div>
              <div className={styles.cardValue}>{kpis.acessaram}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{kpis.criaram_senha} criaram senha</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Concluíram o curso</div>
              <div className={styles.cardValue}>{kpis.concluiram_curso}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{kpis.certificados} certificado(s) liberado(s)</div>
            </div>
            <div className={styles.card} style={{ borderColor: kpis.nunca_acessaram > 0 ? 'rgba(245,158,11,0.45)' : undefined, borderWidth: kpis.nunca_acessaram > 0 ? 1 : undefined, borderStyle: kpis.nunca_acessaram > 0 ? 'solid' : undefined }}>
              <div className={styles.cardLabel}>Ainda não acessaram</div>
              <div className={styles.cardValue} style={{ color: kpis.nunca_acessaram > 0 ? 'var(--ink-amber, #d97706)' : undefined }}>{kpis.nunca_acessaram}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>avise pelo WhatsApp (filtro “Não acessaram”)</div>
            </div>
          </div>

          {/* ═══ JORNADA COMPLETA ═══ */}
          <div style={{ marginTop: 28 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>Jornada do cliente</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>Da visita na página até entrar no app, concluir o curso e emitir o certificado.</p>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '10px 4px' }}>
              {(() => {
                const j = data!.jornada; const topo = j[0]?.value || 1;
                return j.map((s, i) => {
                  const prev = i > 0 ? j[i - 1].value : null;
                  const doTopo = i === 0 ? 100 : Math.round((s.value / topo) * 100);
                  const doAnt = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
                  return (
                    <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 150px', gap: 14, alignItems: 'center', padding: '9px 16px', borderBottom: i < j.length - 1 ? '1px solid var(--color-border)' : 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{i + 1}. {s.label}</div>
                      <div style={{ background: 'var(--color-surface-2)', borderRadius: 999, height: 12, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(doTopo, s.value > 0 ? 3 : 0)}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 999, transition: 'width .4s ease' }} />
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 13 }}>
                        <span style={{ fontWeight: 800 }}>{s.value.toLocaleString('pt-BR')}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}> · {doTopo}%</span>
                        {doAnt !== null && <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}> ({doAnt}% do passo)</span>}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
              Visitou/Clicou vêm do tracking da landing; do <b>Comprou</b> em diante é o app (por e-mail). O detalhe de aquisição + recuperação de checkout fica na aba <b>Funil LimpaPro</b>.
            </div>
          </div>

          {/* ═══ ENGAJAMENTO POR MÓDULO ═══ */}
          <div style={{ marginTop: 32 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>Onde a galera está no curso</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>Quantos concluíram cada módulo. Bônus contam sobre a base Premium (quem pode acessar).</p>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '8px 4px' }}>
              {data!.engajamento.map((e, i, arr) => (
                <div key={e.slug} style={{ display: 'grid', gridTemplateColumns: '210px 1fr 96px', gap: 14, alignItems: 'center', padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--color-border)' : 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
                    {e.label}
                    {e.bonus && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--color-primary)', letterSpacing: '0.04em' }}>PREMIUM</span>}
                  </div>
                  <div style={{ background: 'var(--color-surface-2)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(e.pct, e.feitos > 0 ? 3 : 0)}%`, height: '100%', background: e.bonus ? 'var(--ink-amber, #d97706)' : 'var(--ink-green, #16a34a)', borderRadius: 999 }} />
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13 }}>
                    <span style={{ fontWeight: 800 }}>{e.feitos}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>/{e.base} · {e.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ ACESSOS LIBERADOS (ownership) ═══ */}
          <div style={{ marginTop: 32 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>Acessos liberados</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>Quantos membros têm cada produto/plano liberado no app.</p>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '8px 4px' }}>
              {data!.produtos.map((p, i, arr) => (
                <div key={p.slug} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 90px', gap: 14, alignItems: 'center', padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--color-border)' : 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 7 }}>
                    {p.label}
                    {p.tipo === 'plano' && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--color-primary)' }}>PLANO</span>}
                  </div>
                  <div style={{ background: 'var(--color-surface-2)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(p.pct, p.donos > 0 ? 3 : 0)}%`, height: '100%', background: barColor(p.tipo), borderRadius: 999 }} />
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13 }}>
                    <span style={{ fontWeight: 800 }}>{p.donos}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}> · {p.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ MAIS CLICADOS NO APP (uso interno) ═══ */}
          {data!.cliques_app && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>Mais clicados no app</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
                O que os alunos mais abrem e onde clicam pra comprar — pra entender o que engaja e onde melhorar.
                {data!.cliques_app.total > 0 && <> · <b>{data!.cliques_app.total.toLocaleString('pt-BR')}</b> cliques no total</>}
              </p>
              {data!.cliques_app.total === 0 ? (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '20px 18px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Ainda não há cliques registrados. O tracking começou agora — os dados aparecem aqui conforme os alunos abrem aulas e ofertas no app.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                  {[
                    { titulo: '📚 Aulas mais abertas', lista: data!.cliques_app.aulas, cor: 'var(--ink-green, #16a34a)' },
                    { titulo: '🏷️ Ofertas mais vistas', lista: data!.cliques_app.ofertas, cor: 'var(--color-primary)' },
                    { titulo: '🛒 Cliques em comprar', lista: data!.cliques_app.checkouts, cor: 'var(--ink-amber, #d97706)' },
                  ].map(col => (
                    <div key={col.titulo} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 12 }}>{col.titulo}</div>
                      {col.lista.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>—</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {col.lista.map(item => (
                            <div key={item.alvo} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelAlvo(item.alvo)}</span>
                              <span style={{ fontSize: 13, fontWeight: 800, color: col.cor }}>{item.n.toLocaleString('pt-BR')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ VENDAS DENTRO DO APP (radar de monetização) ═══ */}
          {data!.vendas_internas && (() => {
            const vi = data!.vendas_internas!;
            return (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>Vendas dentro do app</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
                Dinheiro que o app gera sozinho: quem clicou pra comprar um produto por dentro da área de membros e fechou. Quem clicou e não fechou é lead quente pra recuperar.
              </p>
              <div className={styles.cards} style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                <div className={styles.card} style={{ borderColor: 'var(--color-primary)', borderWidth: 2, borderStyle: 'solid' }}>
                  <div className={styles.cardLabel}>Vendido no app · HOJE</div>
                  <div className={styles.cardValue} style={{ color: 'var(--color-primary)' }}>{brl(vi.hoje_valor)}</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Vendido no app · TOTAL</div>
                  <div className={styles.cardValue}>{brl(vi.total_valor)}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{vi.total_qtd} venda(s) interna(s) · máximo acumulado</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Clicaram em comprar</div>
                  <div className={styles.cardValue}>{vi.checkouts}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{vi.convertidos} viraram venda</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Conversão no app</div>
                  <div className={styles.cardValue}>{vi.checkouts > 0 ? vi.conversao_pct + '%' : '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>clicou → comprou</div>
                </div>
              </div>
              {vi.atividade.length > 0 ? (
                <div className={styles.tableWrap} style={{ marginTop: 16 }}>
                  <table className={styles.table}>
                    <thead><tr><th>Membro</th><th>Produto</th><th>Ação no app</th><th>Comprou?</th><th>Valor</th><th>Quando</th></tr></thead>
                    <tbody>
                      {vi.atividade.map((a, i) => {
                        const r = relDateShort(a.criado_em);
                        return (
                          <tr key={a.email + a.produto + a.tipo + i}>
                            <td><div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontWeight: 600 }}>{a.nome || '(sem nome)'}</span><span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{a.email}</span></div></td>
                            <td style={{ fontWeight: 600 }}>{a.produto}</td>
                            <td className={styles.mutedCell}>{a.tipo === 'checkout' ? '🛒 Clicou em comprar' : '👀 Viu a oferta'}</td>
                            <td>{a.comprou
                              ? <span style={{ color: 'var(--ink-green, #16a34a)', fontWeight: 700 }}>✓ Comprou</span>
                              : a.tipo === 'checkout' ? <span style={{ color: 'var(--ink-amber, #d97706)', fontWeight: 700 }}>Não fechou</span> : <span className={styles.emptyDash}>—</span>}</td>
                            <td style={{ fontWeight: 700 }}>{a.valor > 0 ? brl(a.valor) : <span className={styles.emptyDash}>—</span>}</td>
                            <td><span style={{ fontWeight: 600, fontSize: 12, color: r.color }}>{r.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ marginTop: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '20px 18px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Ainda ninguém clicou pra comprar por dentro do app. Aparece aqui na hora que rolar — com valor e quem foi.
                </div>
              )}
            </div>
            );
          })()}

          {/* ═══ TABELA DETALHADA (linha expansível) ═══ */}
          <div style={{ marginTop: 32, marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Base de membros</h3>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>clique numa linha pra ver todos os detalhes</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr>
                <th>Membro</th><th>Plano</th><th>Progresso (5 módulos)</th><th>Certificado</th><th>Situação</th><th>Compra</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map(m => {
                  const isOpen = aberto === m.email;
                  const cert = CERT_META[m.certificado];
                  const cad = relDateShort(m.criado_em);
                  const wa = waLink(m);
                  return (
                    <Fragment key={m.email}>
                      <tr onClick={() => setAberto(isOpen ? null : m.email)} style={{ cursor: 'pointer', background: isOpen ? 'var(--color-surface-2)' : undefined }}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontWeight: 600 }}>{m.nome || '(sem nome)'}</span>
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{m.email}</span>
                          </div>
                        </td>
                        <td>
                          <span className={styles.planTag} style={{
                            background: m.premium ? 'rgba(242,101,19,0.14)' : 'var(--color-surface-2)',
                            color: m.premium ? 'var(--color-primary)' : 'var(--color-text-muted)',
                            borderColor: m.premium ? 'rgba(242,101,19,0.4)' : 'var(--color-border)', fontWeight: 800,
                          }}>{m.premium ? 'COMPLETO' : 'BÁSICO'}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            {MODS.map(md => <ModDot key={md.slug} n={md.n} done={m.modulos_feitos.includes(md.slug)} title={`M${md.n} · ${md.label}`} />)}
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 4 }}>{m.modulos_feitos.length}/5</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: cert.bg, color: cert.fg, border: `1px solid ${cert.bd}` }}>{cert.label}</span>
                        </td>
                        <td className={styles.mutedCell}>
                          {m.acessou ? <span style={{ color: 'var(--ink-green, #16a34a)', fontWeight: 700 }}>Já entrou</span>
                            : m.criou_senha ? 'Criou senha'
                            : <span style={{ color: 'var(--ink-amber, #d97706)', fontWeight: 700 }}>Não acessou</span>}
                        </td>
                        <td><span style={{ fontWeight: 600, fontSize: 12, color: cad.color }}>{cad.label}</span></td>
                        <td style={{ textAlign: 'center', color: 'var(--color-text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--color-surface-2)', padding: '16px 18px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 18 }}>
                              {/* Progresso detalhado */}
                              <div>
                                <div style={detH}>Progresso do curso</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  {MODS.map(md => {
                                    const done = m.modulos_feitos.includes(md.slug);
                                    return <div key={md.slug} style={detRow}><span>{done ? '✅' : '⬜'} M{md.n} · {md.label}</span></div>;
                                  })}
                                </div>
                              </div>
                              {/* Bônus premium */}
                              <div>
                                <div style={detH}>Bônus (Premium)</div>
                                {m.premium ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {BONS.map(b => <div key={b.slug} style={detRow}><span>{m.bonus_feitos.includes(b.slug) ? '✅' : '⬜'} {b.label}</span></div>)}
                                    <div style={detRow}><span>{m.certificado === 'liberado' ? '✅' : '⬜'} Certificado ({CERT_META[m.certificado].label})</span></div>
                                  </div>
                                ) : <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>Plano Básico — bônus e certificado bloqueados.</div>}
                              </div>
                              {/* Acessos + datas */}
                              <div>
                                <div style={detH}>Acessos liberados</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                                  {m.produtos.map(p => <span key={p} className={styles.planTag} style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)', fontSize: 10 }}>{p}</span>)}
                                </div>
                                <div style={detH}>Conta & datas</div>
                                <div style={{ fontSize: 12.5, color: 'var(--color-text)', lineHeight: 1.8 }}>
                                  <div>Compra: <b>{m.criado_em ? fmtDateBR(m.criado_em) : '—'}</b></div>
                                  <div>Criou senha: <b>{m.criou_senha ? 'sim' : 'não'}</b></div>
                                  <div>Último acesso: <b>{m.ultimo_acesso_em ? fmtDateBR(m.ultimo_acesso_em) : 'nunca'}</b></div>
                                  <div>Aulas concluídas: <b>{m.aulas_concluidas}</b></div>
                                </div>
                                {wa && (
                                  <a href={wa} target="_blank" rel="noopener noreferrer" style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, fontSize: 12, fontWeight: 700,
                                    padding: '7px 14px', borderRadius: 8, textDecoration: 'none',
                                    background: m.acessou ? 'var(--color-surface)' : 'rgba(16,185,129,0.12)',
                                    color: m.acessou ? 'var(--color-text-muted)' : 'var(--ink-green, #16a34a)',
                                    border: `1px solid ${m.acessou ? 'var(--color-border)' : 'rgba(16,185,129,0.3)'}`,
                                  }}>{m.acessou ? 'Abrir WhatsApp' : 'Avisar pra acessar'}</a>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={7} className={styles.mutedCell} style={{ textAlign: 'center', padding: '24px 8px' }}>Nenhum membro bate com o filtro/busca.</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 24, padding: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--color-text)' }}>Área interna do app.</strong> Cada linha é um comprador com acesso a
            <code style={{ padding: '0 4px' }}>limpapro.solardoc.app/membros</code>. <b>Plano</b>: Completo (Premium) leva bônus + certificado;
            Básico só os 5 módulos. <b>Progresso</b> conta os módulos marcados como concluídos no app. Clique numa linha pra abrir todos os detalhes.
          </div>
        </>
      )}
    </>
  );
}

const detH: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 };
const detRow: CSSProperties = { fontSize: 12.5, color: 'var(--color-text)' };
