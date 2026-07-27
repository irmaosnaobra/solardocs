'use client';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG & ALERTAS — estado dos kill-switches + saúde do produto. SÓ LEITURA:
// mostra o que está ligado/desligado (por env) e checagens básicas; togglar um flag
// é mudança manual de env de propósito (mexe em pagamento/agente ao vivo).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubConfig } from './hubGerador.types';

function Pill({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  const color = ok ? '#2C9C67' : '#B4544B';
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 999, padding: '3px 11px', whiteSpace: 'nowrap' }}>
      {ok ? on : off}
    </span>
  );
}

export default function ConfigAlertasPanel({ produto }: { produto: string }) {
  const [data, setData] = useState<HubConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/admin/hub-config?produto=${encodeURIComponent(produto)}`).then((r) => setData(r.data as HubConfig)).catch(() => {}).finally(() => setLoading(false));
  }, [produto]);
  useEffect(() => { load(); }, [load]);

  const flags = data?.flags ?? [];
  const saude = data?.saude ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      <div className={styles.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Kill-switches</div>
        {flags.length === 0 ? (
          <p className={styles.empty} style={{ margin: 0 }}>Nenhum kill-switch específico deste produto.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {flags.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{f.detalhe}</div>
                </div>
                <Pill ok={f.ativo} on="Ligado" off="Desligado" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Saúde</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {saude.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.item}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{s.detalhe}</div>
              </div>
              <Pill ok={s.ok} on="OK" off="Verificar" />
            </div>
          ))}
        </div>
      </div>

      <p style={{ marginTop: 12, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Só leitura. Togglar um kill-switch é mudança de variável de ambiente (Vercel) — de propósito fora do painel, porque mexe em pagamento/agente ao vivo.
      </p>
    </div>
  );
}
