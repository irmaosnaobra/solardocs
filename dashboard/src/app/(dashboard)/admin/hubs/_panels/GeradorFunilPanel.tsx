'use client';

// ─────────────────────────────────────────────────────────────────────────────
// FUNIL (Solar / Eletroposto) — leads de agendamentos (Gerador) por status.
// Lê /admin/hub-gerador?produto=X. Barras proporcionais + total + quentes.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubGerador } from './hubGerador.types';

const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo', nao_atendeu: 'Não atendeu', agendado: 'Agendado',
  falando_whatsapp: 'Falando no WhatsApp', fez_orcamento: 'Fez orçamento',
  vendido: 'Vendido', cancelado: 'Cancelado', sem_interesse: 'Sem interesse',
  reativacao: 'Reativação',
};
const label = (s: string) => STATUS_LABEL[s] ?? s;

export default function GeradorFunilPanel({ produto }: { produto: string }) {
  const [data, setData] = useState<HubGerador | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/admin/hub-gerador?produto=${encodeURIComponent(produto)}`).then((r) => setData(r.data as HubGerador)).catch(() => {}).finally(() => setLoading(false));
  }, [produto]);
  useEffect(() => { load(); }, [load]);

  const entries = Object.entries(data?.por_status ?? {}).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}><div className={styles.cardLabel}>Total de leads</div><div className={styles.cardValue}>{(data?.total ?? 0).toLocaleString('pt-BR')}</div></div>
        <div className={styles.card}><div className={styles.cardLabel}>Com temperatura</div><div className={styles.cardValue} style={{ color: '#C87A1E' }}>{(data?.com_temperatura ?? 0).toLocaleString('pt-BR')}</div></div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Leads por status</div>
        {entries.length === 0 ? (
          <p className={styles.empty} style={{ margin: 0 }}>{loading ? 'Carregando…' : 'Sem leads deste produto.'}</p>
        ) : (
          <div className={styles.funnelSteps}>
            {entries.map(([st, n]) => (
              <div key={st} className={styles.funnelStep}>
                <div className={styles.funnelLabel}>{label(st)}</div>
                <div className={styles.funnelBar}><div className={styles.funnelFill} style={{ width: `${max > 0 ? Math.round((n / max) * 100) : 0}%` }} /></div>
                <div className={styles.funnelValue}>{n.toLocaleString('pt-BR')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Fonte: <code>/admin/hub-gerador</code> (agendamentos do Gerador, created_by do produto).
      </p>
    </div>
  );
}
