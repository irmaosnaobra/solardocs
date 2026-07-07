'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../indicacoes-io/page.module.css';

interface Indicacao {
  id: string;
  indicado_nome: string;
  indicado_telefone: string;
  indicado_telefone_raw: string | null;
  indicador_nome: string;
  indicador_pix: string;
  status: 'novo' | 'contatado' | 'fechado' | 'pago';
  observacoes: string | null;
  origem: string | null;
  created_at: string;
}

const STATUS_OPTS: Indicacao['status'][] = ['novo', 'contatado', 'fechado', 'pago'];
const STATUS_LABEL: Record<Indicacao['status'], string> = {
  novo: 'Novo',
  contatado: 'Contatado',
  fechado: 'Fechado',
  pago: 'Pago',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function waLink(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits}`;
}

export default function IndicacoesIoPanel() {
  const { user } = useDashboard();

  const [rows, setRows] = useState<Indicacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'todos' | Indicacao['status']>('todos');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/io-indicacoes/admin');
      setRows(data.indicacoes || []);
    } catch {
      setError('Não consegui carregar as indicações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.is_admin) load();
  }, [load, user]);

  async function setStatus(r: Indicacao, status: Indicacao['status']) {
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, status } : x)));
    try {
      await api.patch(`/io-indicacoes/admin/${r.id}`, { status });
    } catch {
      await load();
    }
  }

  async function remove(r: Indicacao) {
    if (!confirm(`Excluir a indicação de "${r.indicado_nome}"?`)) return;
    setRows(prev => prev.filter(x => x.id !== r.id));
    try {
      await api.delete(`/io-indicacoes/admin/${r.id}`);
    } catch {
      await load();
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
  }

  if (!user || !user.is_admin) return null;

  const visible = filter === 'todos' ? rows : rows.filter(r => r.status === filter);
  const counts = STATUS_OPTS.reduce((acc, s) => {
    acc[s] = rows.filter(r => r.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Indicações — Ganhe PIX</h1>
          <p className={styles.subtitle}>
            Indicações vindas de{' '}
            <a href="https://solardoc.app/io/indicacao" target="_blank" rel="noopener" className={styles.publicLink}>
              solardoc.app/io/indicacao
            </a>
            . Quando o projeto fechar e instalar, pague o PIX e marque como “Pago”.
          </p>
        </div>
        <button className={styles.btnGhost} onClick={load}>↻ Atualizar</button>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.filters}>
        <button className={`${styles.chip} ${filter === 'todos' ? styles.chipOn : ''}`} onClick={() => setFilter('todos')}>
          Todos <span>{rows.length}</span>
        </button>
        {STATUS_OPTS.map(s => (
          <button key={s} className={`${styles.chip} ${filter === s ? styles.chipOn : ''}`} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]} <span>{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.empty}>Carregando…</div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>Nenhuma indicação {filter !== 'todos' ? `com status “${STATUS_LABEL[filter as Indicacao['status']]}”` : 'ainda'}.</div>
      ) : (
        <div className={styles.list}>
          {visible.map(r => (
            <div key={r.id} className={`${styles.card} ${styles['st_' + r.status]}`}>
              <div className={styles.cardHead}>
                <span className={`${styles.statusTag} ${styles['tag_' + r.status]}`}>{STATUS_LABEL[r.status]}</span>
                <span className={styles.date}>{fmtDate(r.created_at)}</span>
              </div>

              <div className={styles.block}>
                <span className={styles.blockLabel}>Indicado (quer o orçamento)</span>
                <div className={styles.blockMain}>
                  <strong>{r.indicado_nome}</strong>
                  <div className={styles.contactRow}>
                    <a href={waLink(r.indicado_telefone)} target="_blank" rel="noopener" className={styles.waBtn}>
                      {r.indicado_telefone_raw || r.indicado_telefone}
                    </a>
                  </div>
                </div>
              </div>

              <div className={styles.block}>
                <span className={styles.blockLabel}>Indicador (recebe o PIX)</span>
                <div className={styles.blockMain}>
                  <strong>{r.indicador_nome}</strong>
                  <button className={styles.pixBtn} onClick={() => copy(r.indicador_pix)} title="Copiar chave PIX">
                    {r.indicador_pix} <span className={styles.copyHint}>copiar</span>
                  </button>
                </div>
              </div>

              <div className={styles.cardActions}>
                <div className={styles.statusPicker}>
                  {STATUS_OPTS.map(s => (
                    <button
                      key={s}
                      className={`${styles.stBtn} ${r.status === s ? styles.stBtnOn : ''}`}
                      onClick={() => setStatus(r, s)}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                <button className={styles.delBtn} onClick={() => remove(r)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
