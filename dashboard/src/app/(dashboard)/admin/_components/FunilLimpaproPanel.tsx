'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

type Period = 'hoje' | 'ontem' | '3dias' | '7dias' | 'mes' | 'maximo';

interface FunnelStep {
  key: 'visita' | 'checkout' | 'venda';
  label: string;
  count: number;
  sub?: string;
}
interface FunnelStats {
  clientes: number;
  vendas: number;
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

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

const PERIODS: { value: Period; label: string }[] = [
  { value: 'hoje',   label: 'Hoje' },
  { value: 'ontem',  label: 'Ontem' },
  { value: '3dias',  label: '3 dias' },
  { value: '7dias',  label: '7 dias' },
  { value: 'mes',    label: 'Esse mês' },
  { value: 'maximo', label: 'Máximo' },
];

// Degradê azul → amarelo (paleta da landing LimpaPro).
const STEP_COLORS: Record<FunnelStep['key'], { bg: string; border: string; accent: string }> = {
  visita:   { bg: 'rgba(59, 130, 246, 0.10)',  border: 'rgba(59, 130, 246, 0.30)',  accent: 'var(--ink-blue)' },
  checkout: { bg: 'rgba(245, 158, 11, 0.10)',  border: 'rgba(245, 158, 11, 0.30)',  accent: 'var(--ink-amber)' },
  venda:    { bg: 'rgba(16, 185, 129, 0.10)',  border: 'rgba(16, 185, 129, 0.30)',  accent: 'var(--ink-green)' },
};

const STEP_DESCRIPTIONS: Record<FunnelStep['key'], string> = {
  visita:   'Visitaram limpapro.solardoc.app (Pixel + tracking próprio)',
  checkout: 'Clicaram no botão de compra (vão pro checkout)',
  venda:    'Pedidos pagos na Kiwify (cada produto/order bump conta 1)',
};

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default function FunilLimpaproPanel() {
  const [period, setPeriod] = useState<Period>('7dias');
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<FunnelData>('/admin/funnel-limpapro', { params: { period } });
      setData(data);
    } catch {
      setError('Erro ao carregar funil. Tenta de novo.');
    } finally {
      setLoading(false);
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
            Curso de limpeza de placas (Kiwify) · Visita → Clique no checkout → Compra · visitas únicas por sessão, pedidos pagos via webhook
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
        <div style={{ padding: 24, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, color: 'var(--ink-red)' }}>
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
                        <div style={{ fontSize: 10, color: 'var(--ink-red)', fontWeight: 700 }}>
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
                      <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11, color: colors.accent, fontWeight: 700, letterSpacing: '0.04em' }}>
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
              const visita = by('visita'), checkout = by('checkout'), venda = by('venda');
              return [
                { label: 'Visita → Clique', val: pct(checkout, visita) },
                { label: 'Clique → Compra', val: pct(venda, checkout) },
                { label: 'Visita → Compra', val: pct(venda, visita) },
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
              { label: 'Faturamento',     val: brl(data.faturamento),                 hint: 'valor cobrado (bruto)',  accent: 'var(--ink-green)' },
              { label: 'Líquido',         val: brl(data.liquido),                      hint: 'após taxa Kiwify (= tela Vendas)', accent: 'var(--ink-green)' },
              { label: 'Vendas',          val: data.stats.vendas.toLocaleString('pt-BR'), hint: 'pedidos pagos',       accent: 'var(--color-text)' },
              { label: 'Clientes',        val: data.stats.clientes.toLocaleString('pt-BR'), hint: 'compradores únicos', accent: 'var(--color-text)' },
              { label: 'Ticket / venda',  val: data.stats.ticketVenda > 0 ? brl(data.stats.ticketVenda) : '—', hint: 'por pedido', accent: 'var(--color-text)' },
              { label: 'Ticket / cliente',val: data.stats.ticketCliente > 0 ? brl(data.stats.ticketCliente) : '—', hint: 'gasto médio por comprador', accent: 'var(--color-text)' },
              { label: 'Reembolsos',      val: data.stats.reembolsos.toLocaleString('pt-BR'), hint: data.stats.reembolsoValor > 0 ? `−${brl(data.stats.reembolsoValor)}` : 'nenhum', accent: data.stats.reembolsos > 0 ? 'var(--ink-red)' : 'var(--color-text-muted)' },
              { label: 'Aguardando',      val: data.stats.aguardando.toLocaleString('pt-BR'), hint: 'pix/boleto não pago', accent: 'var(--ink-amber)' },
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
                    <div style={{ textAlign: 'right', color: 'var(--ink-amber)', fontWeight: 700 }}>
                      {data.faturamento > 0 ? `${((p.receita / data.faturamento) * 100).toFixed(0)}%` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notas */}
          <div style={{ marginTop: 32, padding: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--color-text)' }}>Como ler:</strong> Visita e Clique são
            únicos por sessão. <b>Vendas</b> = pedidos pagos (cada produto/order bump da Kiwify conta 1);
            <b>Clientes</b> = compradores distintos. Por isso quem leva vários produtos no mesmo checkout
            faz "Vendas" {'>'} "Clientes" — e a conversão Clique → Compra pode passar de 100%.
            <br /><br />
            <strong style={{ color: 'var(--ink-amber)' }}>Fonte dos dados:</strong> Visita e Clique vêm do
            tracking próprio da landing <code style={{ padding: '0 4px' }}>limpapro.solardoc.app</code>;
            as vendas vêm do <b>webhook da Kiwify</b> (status pago). <b>Faturamento</b> = valor cobrado bruto;
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
