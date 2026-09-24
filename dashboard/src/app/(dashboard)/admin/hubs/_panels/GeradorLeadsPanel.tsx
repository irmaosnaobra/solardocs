'use client';

// ─────────────────────────────────────────────────────────────────────────────
// LEADS (Solar / Eletroposto) — lista dos leads de agendamentos (Gerador).
// Lê /admin/hub-gerador?produto=X.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubGerador } from './hubGerador.types';

const STATUS_LABEL: Record<string, string> = {
  // Os rótulos são os MESMOS da agenda (ETIQUETA_STATUS em /gerador/agenda): dois
  // nomes pro mesmo status fariam a mesma reunião parecer duas coisas em duas
  // telas. Os antigos `novo`, `vendido` e `reativacao` saíram porque a tabela
  // nunca gravou nenhum deles, enquanto os status reais do card apareciam crus.
  agendado: 'Agendado', nao_atendeu: 'Não atendeu', falando_whatsapp: 'Falando no WhatsApp',
  em_atendimento: 'Negociando', sem_orcamento: 'Sem orçamento', fez_orcamento: 'Fez orçamento',
  proposta_apresentada: 'Proposta apresentada', sem_interesse: 'Sem interesse',
  arrendamento: 'Arrendamento', carregador: 'Carregador', meio_a_meio: '50/50',
  chave_na_mao: 'Chave na mão', fechou: 'Vendido', fechou_concorrente: 'Concorrente',
  cancelado: 'Cancelado',
};
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

export default function GeradorLeadsPanel({ produto }: { produto: string }) {
  const [data, setData] = useState<HubGerador | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/admin/hub-gerador?produto=${encodeURIComponent(produto)}`).then((r) => setData(r.data as HubGerador)).catch(() => {}).finally(() => setLoading(false));
  }, [produto]);
  useEffect(() => { load(); }, [load]);

  const leads = data?.leads ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{(data?.total ?? 0).toLocaleString('pt-BR')} leads · mostrando {leads.length}</span>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Cliente</th><th>Cidade</th><th>Status</th><th>Consultor</th><th style={{ textAlign: 'right' }}>Entrou</th></tr></thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>{loading ? 'Carregando…' : 'Sem leads deste produto.'}</td></tr>
            )}
            {leads.map((l, i) => (
              <tr key={i}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.nome || '—'} {l.temperatura ? '🔥' : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{l.telefone || ''}</div>
                </td>
                <td>{l.cidade || '—'}</td>
                <td>{l.status ? (STATUS_LABEL[l.status] ?? l.status) : '—'}</td>
                <td>{l.consultor || '—'}</td>
                <td style={{ textAlign: 'right', fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtWhen(l.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Fonte: <code>/admin/hub-gerador</code> (agendamentos do Gerador). Só leitura.
      </p>
    </div>
  );
}
