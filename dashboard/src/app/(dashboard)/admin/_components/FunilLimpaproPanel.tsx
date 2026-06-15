'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

type Period = 'hoje' | 'ontem' | '3dias' | '7dias' | 'mes' | 'maximo';

interface FunnelStep {
  key: 'visita' | 'clique' | 'checkout' | 'venda';
  label: string;
  count: number;
  sub?: string;
}
interface FunnelStats {
  clientes: number;
  vendas: number;
  abandonos: number;
  liquido: number;
  ticketVenda: number;
  ticketCliente: number;
  reembolsos: number;
  reembolsoValor: number;
  recusados: number;
  aguardando: number;
}
interface ProdutoVendido {
  name: string;
  vendas: number;
  receita: number;
}
interface FunnelData {
  period: Period;
  since: string;
  steps: FunnelStep[];
  faturamento: number;
  liquido: number;
  stats: FunnelStats;
  produtos: ProdutoVendido[];
}

// ── Recuperação de checkout (endpoint /admin/leads-limpapro) ──
interface LeadAberto {
  nome: string | null;
  email: string;
  telefone: string | null;
  whatsapp_url: string | null;
  telefone_suspeito: boolean;
  produto: string | null;
  status: 'pix_gerado' | 'abandonou';
  valor_centavos: number | null;
  valor_estimado: boolean;
  quando_iso: string | null;
  quando_label: string | null;
  horas_desde: number | null;
  pix_expira_iso: string | null;
  pix_ativo: boolean;
}
interface LeadsMetrics {
  recuperados_total: number;
  recuperados_no_periodo: number;
  em_aberto_total: number;
  em_aberto_com_valor: number;
  falsos_positivos: number;
  pessoas_checkout_aberto: number;
  rs_na_mesa: number;
}
interface LeadsData {
  metrics: LeadsMetrics;
  leads_abertos: LeadAberto[];
}

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

// Idade do lead em texto curto ("há 3 dias", "há 5h").
function idadeLabel(horas: number | null): string {
  if (horas == null) return '';
  if (horas < 1) return 'agora há pouco';
  if (horas < 24) return `há ${Math.round(horas)}h`;
  return `há ${Math.round(horas / 24)} dia${Math.round(horas / 24) > 1 ? 's' : ''}`;
}

// Mensagem de WhatsApp pré-preenchida por estado (URL-encoded).
function waLink(lead: LeadAberto): string | null {
  if (!lead.whatsapp_url) return null;
  const nome = (lead.nome || '').trim().split(/\s+/)[0];
  const saud = nome ? `Oi ${nome}!` : 'Oi, tudo bem?';
  const produto = lead.produto || 'Limpa Solar Pro';
  // 3 cenários: pix ativo (link ainda vale) · pix vencido (gerar novo) · abandono puro.
  let msg: string;
  if (lead.status === 'pix_gerado' && lead.pix_ativo) {
    msg = `${saud} Seu Pix do ${produto} foi gerado mas ainda não caiu. Quer que eu te reenvie o link pra finalizar?`;
  } else if (lead.status === 'pix_gerado') {
    msg = `${saud} Você gerou o Pix do ${produto} mas ele acabou expirando. Quer que eu gere um link novo pra você concluir?`;
  } else {
    msg = `${saud} Vi que você começou a compra do ${produto} e não finalizou. Posso te ajudar a concluir?`;
  }
  return `${lead.whatsapp_url}?text=${encodeURIComponent(msg)}`;
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
// "% do topo" (1 acento esparso por card, não o label inteiro).
const STEP_COLORS: Record<FunnelStep['key'], { bg: string; border: string; accent: string }> = {
  visita:   { bg: 'var(--color-surface-2)',  border: 'var(--color-border)',  accent: 'var(--color-text)' },
  clique:   { bg: 'var(--color-surface-2)',  border: 'var(--color-border)',  accent: 'var(--color-text)' },
  checkout: { bg: 'var(--color-surface-2)',  border: 'var(--color-border)',  accent: 'var(--color-text)' },
  venda:    { bg: 'var(--color-surface-2)',  border: 'var(--color-border)',  accent: 'var(--color-text)' },
};

const STEP_DESCRIPTIONS: Record<FunnelStep['key'], string> = {
  visita:   'Visitaram limpapro.solardoc.app (Pixel + tracking próprio)',
  clique:   'Clicaram no botão de compra na landing',
  checkout: 'Preencheram o checkout da Kiwify (pagaram ou abandonaram)',
  venda:    'Compradores únicos — pessoas que concluíram a compra',
};

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default function FunilLimpaproPanel() {
  const [period, setPeriod] = useState<Period>('7dias');
  const [data, setData] = useState<FunnelData | null>(null);
  const [leads, setLeads] = useState<LeadsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError('');
    // O funil é o conteúdo principal e já está em produção; os leads vêm de um
    // endpoint novo. Buscas SEPARADAS de propósito: se /leads-limpapro falhar (ex.:
    // ainda não deployado → 404), o funil NÃO pode quebrar junto — só some o bloco
    // de recuperação (guardado por {leads && …}).
    try {
      const { data } = await api.get<FunnelData>('/admin/funnel-limpapro', { params: { period } });
      setData(data);
    } catch {
      setError('Erro ao carregar funil. Tenta de novo.');
    } finally {
      setLoading(false);
    }
    try {
      const { data } = await api.get<LeadsData>('/admin/leads-limpapro', { params: { period } });
      setLeads(data);
    } catch {
      setLeads(null); // endpoint indisponível → esconde o bloco, não derruba o painel
    }
  }, [period]);

  useEffect(() => { fetchFunnel(); }, [fetchFunnel]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32, flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
            Funil LimpaPro
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: '6px 0 0' }}>
            Curso de limpeza de placas (Kiwify) · Visitou → Clicou → Entrou no checkout → Comprou · pessoas únicas em cada etapa
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
        const steps = data.steps;
        const topCount = steps[0]?.count ?? 0;
        return (
        <>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap', marginBottom: 40 }}>
            {steps.map((step, i, arr) => {
              const colors = STEP_COLORS[step.key];
              const prevStep = i > 0 ? arr[i - 1] : null;
              const prevPct = prevStep ? pct(step.count, prevStep.count) : null;
              const dropoff = prevStep && prevStep.count > 0
                ? ((prevStep.count - step.count) / prevStep.count * 100).toFixed(1)
                : null;
              const totalPct = i === 0 ? null : pct(step.count, topCount);

              return (
                <div key={step.key} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 240px', minWidth: 240 }}>
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

          {/* Conversões do funil */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
            {(() => {
              const by = (key: FunnelStep['key']) => steps.find(s => s.key === key)?.count ?? 0;
              const visita = by('visita'), clique = by('clique'), checkout = by('checkout'), venda = by('venda');
              return [
                { label: 'Visita → Clique',    val: pct(clique, visita) },
                { label: 'Clique → Checkout',  val: pct(checkout, clique) },
                { label: 'Checkout → Compra',  val: pct(venda, checkout) },
                { label: 'Visita → Compra',    val: pct(venda, visita) },
              ];
            })().map(m => (
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

          {/* Painel de vendas — números reais da Kiwify (banco) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            {[
              { label: 'Faturamento',     val: brl(data.faturamento),                 hint: 'valor cobrado (bruto)',  accent: 'var(--color-primary)' },
              { label: 'Líquido',         val: brl(data.liquido),                      hint: 'após taxa Kiwify (= tela Vendas)', accent: 'var(--color-primary)' },
              { label: 'Vendas',          val: data.stats.vendas.toLocaleString('pt-BR'), hint: 'pedidos pagos',       accent: 'var(--color-text)' },
              { label: 'Clientes',        val: data.stats.clientes.toLocaleString('pt-BR'), hint: 'compradores únicos', accent: 'var(--color-text)' },
              { label: 'Ticket / venda',  val: data.stats.ticketVenda > 0 ? brl(data.stats.ticketVenda) : '—', hint: 'por pedido', accent: 'var(--color-text)' },
              { label: 'Ticket / cliente',val: data.stats.ticketCliente > 0 ? brl(data.stats.ticketCliente) : '—', hint: 'gasto médio por comprador', accent: 'var(--color-text)' },
              { label: 'Abandonos',       val: data.stats.abandonos.toLocaleString('pt-BR'), hint: 'entraram no checkout, não compraram', accent: 'var(--color-text)' },
              { label: 'Reembolsos',      val: data.stats.reembolsos.toLocaleString('pt-BR'), hint: data.stats.reembolsoValor > 0 ? `−${brl(data.stats.reembolsoValor)}` : 'nenhum', accent: 'var(--color-text)' },
              { label: 'Aguardando',      val: data.stats.aguardando.toLocaleString('pt-BR'), hint: 'pix/boleto não pago', accent: 'var(--color-text)' },
              { label: 'Recusados',       val: data.stats.recusados.toLocaleString('pt-BR'), hint: 'cartão negado', accent: 'var(--color-text-muted)' },
            ].map(m => (
              <div key={m.label} style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '16px 18px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: m.accent }}>
                  {m.val}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {m.hint}
                </div>
              </div>
            ))}
          </div>

          {/* Produtos vendidos */}
          {data.produtos.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 14px' }}>
                Produtos vendidos
              </h3>
              <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
                {/* Cabeçalho */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 140px 90px', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--color-border)', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  <div>Produto</div>
                  <div style={{ textAlign: 'right' }}>Vendas</div>
                  <div style={{ textAlign: 'right' }}>Receita</div>
                  <div style={{ textAlign: 'right' }}>% fat.</div>
                </div>
                {data.produtos.map((p, i) => (
                  <div key={p.name} style={{
                    display: 'grid', gridTemplateColumns: '1fr 90px 140px 90px', gap: 12,
                    padding: '12px 18px', alignItems: 'center', fontSize: 14,
                    borderBottom: i < data.produtos.length - 1 ? '1px solid var(--color-border)' : 0,
                  }}>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{p.vendas.toLocaleString('pt-BR')}</div>
                    <div style={{ textAlign: 'right', fontWeight: 700 }}>{brl(p.receita)}</div>
                    <div style={{ textAlign: 'right', color: 'var(--color-text-muted)', fontWeight: 700 }}>
                      {data.faturamento > 0 ? `${((p.receita / data.faturamento) * 100).toFixed(0)}%` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recuperação de checkout (leads pra followup) */}
          {leads && (
            <div style={{ marginTop: 32 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Recuperação de checkout</h3>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  lista completa · não filtra por período
                </span>
              </div>

              {/* Mini-stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                {[
                  {
                    label: 'Recuperados',
                    val: leads.metrics.recuperados_no_periodo.toLocaleString('pt-BR'),
                    hint: `compraram após abandonar · ${PERIODS.find(p => p.value === period)?.label.toLowerCase()}`,
                    accent: 'var(--ink-green)',
                  },
                  {
                    label: 'Em aberto',
                    val: leads.metrics.em_aberto_total.toLocaleString('pt-BR'),
                    hint: 'leads pra contatar (cumulativo)',
                    accent: 'var(--ink-amber)',
                  },
                  {
                    label: 'R$ na mesa',
                    val: `${brl(leads.metrics.rs_na_mesa)}*`,
                    hint: 'valor dos checkouts em aberto (estimado)',
                    accent: 'var(--color-text)',
                  },
                ].map(m => (
                  <div key={m.label} style={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 12, padding: '16px 18px',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: m.accent }}>{m.val}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{m.hint}</div>
                  </div>
                ))}
              </div>

              {/* Reconciliação (em pessoas) */}
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12 }}>
                {leads.metrics.pessoas_checkout_aberto} pessoas entraram no checkout sem comprar ={' '}
                {leads.metrics.em_aberto_total} em aberto + {leads.metrics.recuperados_total} recuperado(s) +{' '}
                {leads.metrics.falsos_positivos} já tinham comprado antes
              </div>

              {/* Lista de leads */}
              {leads.leads_abertos.length > 0 && (
                <div style={{ marginTop: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
                  {/* Cabeçalho */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 120px 120px 110px 130px', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--color-border)', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                    <div>Cliente</div>
                    <div>Produto</div>
                    <div>Estado</div>
                    <div style={{ textAlign: 'right' }}>Checkout</div>
                    <div style={{ textAlign: 'right' }}>Quando</div>
                    <div style={{ textAlign: 'right' }}>Contato</div>
                  </div>
                  {leads.leads_abertos.map((lead, i) => {
                    const wa = waLink(lead);
                    const pixVencido = lead.status === 'pix_gerado' && !lead.pix_ativo;
                    return (
                      <div key={lead.email} style={{
                        display: 'grid', gridTemplateColumns: '1.4fr 1fr 120px 120px 110px 130px', gap: 12,
                        padding: '12px 18px', alignItems: 'center', fontSize: 14,
                        borderBottom: i < leads.leads_abertos.length - 1 ? '1px solid var(--color-border)' : 0,
                      }}>
                        {/* Cliente */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {lead.nome || '(sem nome)'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {lead.email}
                          </div>
                        </div>
                        {/* Produto */}
                        <div style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {lead.produto || '—'}
                        </div>
                        {/* Estado */}
                        <div>
                          <span style={{
                            display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                            background: lead.status === 'pix_gerado' ? 'rgba(245,158,11,0.12)' : 'var(--color-surface-2)',
                            color: lead.status === 'pix_gerado' ? 'var(--ink-amber)' : 'var(--color-text-muted)',
                            border: `1px solid ${lead.status === 'pix_gerado' ? 'rgba(245,158,11,0.3)' : 'var(--color-border)'}`,
                          }}>
                            {lead.status === 'pix_gerado' ? 'Pix gerado' : 'Abandonou'}
                          </span>
                          {pixVencido && (
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3 }}>pix vencido</div>
                          )}
                        </div>
                        {/* Valor do checkout */}
                        <div style={{ textAlign: 'right', fontWeight: 700 }}>
                          {lead.valor_centavos != null
                            ? `${brl(lead.valor_centavos / 100)}${lead.valor_estimado ? '~' : ''}`
                            : '—'}
                        </div>
                        {/* Quando */}
                        <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-text-muted)' }}>
                          <div>{lead.quando_label || '—'}</div>
                          <div style={{ fontSize: 11 }}>{idadeLabel(lead.horas_desde)}</div>
                        </div>
                        {/* Contato */}
                        <div style={{ textAlign: 'right' }}>
                          {wa ? (
                            <a href={wa} target="_blank" rel="noopener noreferrer" style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
                              padding: '6px 12px', borderRadius: 8, textDecoration: 'none',
                              background: 'rgba(16,185,129,0.12)', color: 'var(--ink-green)',
                              border: '1px solid rgba(16,185,129,0.3)',
                            }}>
                              WhatsApp{lead.telefone_suspeito ? ' ⚠' : ''}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Notas */}
          <div style={{ marginTop: 32, padding: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--color-text)' }}>Recuperação de checkout:</strong> aqui ficam quem
            entrou no checkout e <b>não comprou</b> — abandonou ou gerou Pix e não pagou (mais quente). <b>Recuperado</b> =
            abandonou/gerou pix e SÓ DEPOIS comprou; quem comprou antes é falso positivo e fica de fora. A <b>lista é
            sempre completa</b>, não segue o filtro de período (lead antigo ainda dá pra recuperar) — só "Recuperados"
            segue o período. <b>R$ na mesa</b> é estimado: pros Pix usa o valor real do checkout, pros abandonos usa o
            preço do Limpa Solar Pro (R$ 47). "Recuperado" = a pessoa comprou <b>qualquer</b> item depois; se ela tinha
            outro produto avulso abandonado, ele não aparece aqui. ⚠️ Lista com nome e telefone de clientes — só pra
            contato comercial.
            <br /><br />
            <strong style={{ color: 'var(--color-text)' }}>Como ler:</strong> o funil conta <b>pessoas únicas</b>
            em cada etapa, então as barras nunca passam de 100%. <b>Visitou</b> e <b>Clicou</b> vêm da sessão na
            landing; <b>Entrou no checkout</b> e <b>Comprou</b> vêm da pessoa na Kiwify (por e-mail). Como são
            sistemas diferentes, a passagem <b>Clicou → Checkout</b> é uma aproximação. O card <b>Comprou</b>
            mostra compradores únicos; <b>Vendas</b> (pedidos, cada order bump conta 1) e o faturamento aparecem
            como sub-número.
            <br /><br />
            <strong style={{ color: 'var(--color-text)' }}>Fonte dos dados:</strong> Visita e Clique vêm do
            tracking próprio da landing <code style={{ padding: '0 4px' }}>limpapro.solardoc.app</code>;
            checkout e vendas vêm do <b>webhook da Kiwify</b>. <b>Faturamento</b> = valor cobrado bruto;
            <b>Líquido</b> = depois da taxa da Kiwify — é o número que aparece na tela "Vendas" da Kiwify.
            Reembolsos e recusados ficam de fora. <b>Atenção:</b> o webhook começou a registrar em ~06/jun,
            então vendas anteriores a isso (ex.: pré-lançamento) podem não aparecer aqui — confira o total na
            própria Kiwify se precisar do histórico completo.
          </div>
        </>
        );
      })()}
    </div>
  );
}
