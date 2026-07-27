'use client';

// ─────────────────────────────────────────────────────────────────────────────
// VISÃO GERAL / PULSO — a "capa" do produto: os números-chave + a atividade do
// agente, em 30s. Agrega endpoints que já existem (analytics/revenue p/ SolarDoc,
// funnel-limpapro p/ LimpaPro) + /admin/hub-followup. Frontend-only, só leitura.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubFollowup } from './hubFollowup.types';

interface Analytics {
  total: number; today: number;
  funnel: { visits: number; scroll_50: number; saw_precos: number; cta_clicks: number };
  conversion: { cadastros: number; empresas: number; assinantes: number };
}
interface RevenueData { total_mrr: number; total_users: number; }
interface LimpaproFunnel { faturamento: number; stats: { clientes: number; vendas: number; abandonos: number }; steps: { key: string; label: string; count: number }[]; }

interface Tile { label: string; value: string; sub?: string; color?: string; }

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = (v: number) => (v ?? 0).toLocaleString('pt-BR');

export default function VisaoGeralPanel({ produto }: { produto: string }) {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const fu = api.get(`/admin/hub-followup?produto=${encodeURIComponent(produto)}`).then((r) => r.data as HubFollowup).catch(() => null);

    if (produto === 'solardoc') {
      Promise.all([
        api.get('/admin/analytics?limit=1&period=7dias').then((r) => r.data as Analytics).catch(() => null),
        api.get('/admin/revenue?period=mes').then((r) => r.data as RevenueData).catch(() => null),
        fu,
      ]).then(([an, rv, f]) => {
        setTiles([
          { label: 'MRR (mês)', value: fmtBRL(rv?.total_mrr ?? 0), color: 'var(--color-primary)' },
          { label: 'Assinantes', value: fmtN(rv?.total_users ?? 0) },
          { label: 'Visitas LP (7d)', value: fmtN(an?.total ?? 0), sub: `${an?.today ?? 0} hoje` },
          { label: 'Cadastros (7d)', value: fmtN(an?.conversion?.cadastros ?? 0) },
          { label: 'Empresas (7d)', value: fmtN(an?.conversion?.empresas ?? 0) },
          { label: 'Giovanna em conversa', value: fmtN(f?.summary?.em_conversa ?? 0), sub: `${f?.summary?.handoff ?? 0} handoff`, color: '#2C9C67' },
        ]);
      }).finally(() => setLoading(false));
    } else if (produto === 'limpapro') {
      Promise.all([
        api.get('/admin/funnel-limpapro?period=mes').then((r) => r.data as LimpaproFunnel).catch(() => null),
        fu,
      ]).then(([lf, f]) => {
        const step = (k: string) => lf?.steps?.find((s) => s.key === k)?.count ?? 0;
        setTiles([
          { label: 'Faturamento (mês)', value: fmtBRL(lf?.faturamento ?? 0), color: 'var(--color-primary)' },
          { label: 'Vendas', value: fmtN(lf?.stats?.vendas ?? 0) },
          { label: 'Compradores', value: fmtN(lf?.stats?.clientes ?? 0) },
          { label: 'Visitas LP', value: fmtN(step('visita')) },
          { label: 'Checkout', value: fmtN(step('checkout')), sub: `${lf?.stats?.abandonos ?? 0} abandonos` },
          { label: 'Bia em conversa', value: fmtN(f?.summary?.em_conversa ?? 0), sub: `${f?.summary?.handoff ?? 0} handoff`, color: '#2C9C67' },
        ]);
      }).finally(() => setLoading(false));
    } else {
      fu.then((f) => setTiles([{ label: 'Sessões do agente', value: fmtN(f?.summary?.total ?? 0) }])).finally(() => setLoading(false));
    }
  }, [produto]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>
      {!tiles ? (
        <div className={styles.card}><p className={styles.empty} style={{ margin: 0 }}>Carregando…</p></div>
      ) : (
        <div className={styles.cards}>
          {tiles.map((t, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.cardLabel}>{t.label}</div>
              <div className={styles.cardValue} style={t.color ? { color: t.color } : undefined}>{t.value}</div>
              {t.sub && <div className={styles.cardSub}>{t.sub}</div>}
            </div>
          ))}
        </div>
      )}
      <p style={{ marginTop: 12, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Pulso agregado dos endpoints do produto (analytics / revenue / funil + atividade do agente). Só leitura.
      </p>
    </div>
  );
}
