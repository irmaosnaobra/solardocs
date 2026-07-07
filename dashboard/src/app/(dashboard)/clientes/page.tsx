'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import api from '@/services/api';
import ClientModal from '@/components/ClientModal/ClientModal';
import styles from './clientes.module.css';

interface Client {
  id: string;
  nome: string;
  tipo: 'PF' | 'PJ';
  nacionalidade?: string;
  cpf_cnpj?: string;
  endereco?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  concessionaria?: string;
  email?: string;
  telefone?: string;
  telefone2?: string;
  padrao?: string;
  tipo_telhado?: string;
  created_at?: string;
}

type SortKey = 'created_at' | 'nome';
type SortDir = 'asc' | 'desc';

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

export default function ClientesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir(k === 'created_at' ? 'desc' : 'asc');
    }
  }

  const sortedClients = [...clients].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'created_at') {
      cmp = (a.created_at || '').localeCompare(b.created_at || '');
    } else {
      cmp = (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Paginação
  const totalPages = Math.max(1, Math.ceil(sortedClients.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedClients = sortedClients.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Reseta pra página 0 quando busca/sort muda
  useEffect(() => { setPage(0); }, [search, sortKey, sortDir]);

  const fetchClients = useCallback(async (searchTerm?: string) => {
    try {
      const params = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      const { data } = await api.get(`/clients${params}`);
      setClients(data.clients);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  useEffect(() => {
    const timer = setTimeout(() => fetchClients(search), 300);
    return () => clearTimeout(timer);
  }, [search, fetchClients]);

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      await api.delete(`/clients/${id}`);
      setClients(prev => prev.filter(c => c.id !== id));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setDeleteError(e.response?.data?.error || 'Erro ao excluir cliente');
    } finally {
      setDeletingId(null);
    }
  }

  function handleModalSave(client: Client) {
    if (editingClient) {
      setClients(prev => prev.map(c => c.id === client.id ? client : c));
    } else {
      setClients(prev => [client, ...prev]);
    }
    setShowModal(false);
    setEditingClient(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Clientes</h1>
          <p className={styles.subtitle}>{clients.length} {clients.length === 1 ? 'cliente cadastrado' : 'clientes cadastrados'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            href="/escanear-conta"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 16px',
              borderRadius: 10,
              fontSize: '0.92rem',
              fontWeight: 700,
              textDecoration: 'none',
              color: '#0f172a',
              background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
              boxShadow: '0 4px 14px rgba(245,158,11,0.3)',
              whiteSpace: 'nowrap',
            }}
          >
            📸 Escanear Conta
          </Link>
          <button className="btn-primary" onClick={() => { setEditingClient(null); setShowModal(true); }}>
            + Novo Cliente
          </button>
        </div>
      </div>

      {deleteError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 14 }}>
          ⚠️ {deleteError}
          <button onClick={() => setDeleteError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <div className={styles.searchBar}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome..."
          className="input-field"
        />
      </div>

      {loading ? (
        <p className={styles.empty}>Carregando...</p>
      ) : clients.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>👥</span>
          <p>{search ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</p>
          {!search && (
            <button className="btn-primary" onClick={() => { setEditingClient(null); setShowModal(true); }}>
              Cadastrar primeiro cliente
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort('nome')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Nome {sortKey === 'nome' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Tipo</th>
                <th>CPF / CNPJ</th>
                <th>Cidade / UF</th>
                <th>Concessionária</th>
                <th onClick={() => toggleSort('created_at')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Cadastrado em {sortKey === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {pagedClients.map(client => (
                <tr key={client.id}>
                  <td className={styles.clientName}>{client.nome}</td>
                  <td>
                    <span className={`${styles.tipoBadge} ${client.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                      {client.tipo || 'PF'}
                    </span>
                  </td>
                  <td>{client.cpf_cnpj || '—'}</td>
                  <td>{client.cidade ? `${client.cidade}${client.uf ? `/${client.uf}` : ''}` : '—'}</td>
                  <td>{client.concessionaria || '—'}</td>
                  <td>{fmtDate(client.created_at)}</td>
                  <td>
                    <div className={styles.actions}>
                      <button className={styles.editBtn} onClick={() => { setEditingClient(client); setShowModal(true); }}>
                        Editar
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(client.id)}
                        disabled={deletingId === client.id}
                      >
                        {deletingId === client.id ? '...' : 'Excluir'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className={styles.cardList}>
          {pagedClients.map(client => (
            <div key={client.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.cardName}>{client.nome}</span>
                <span className={`${styles.tipoBadge} ${client.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                  {client.tipo || 'PF'}
                </span>
              </div>
              {client.cpf_cnpj && <p className={styles.cardDetail}>📋 {client.cpf_cnpj}</p>}
              {(client.cidade || client.uf) && (
                <p className={styles.cardDetail}>📍 {client.cidade}{client.uf ? `/${client.uf}` : ''}</p>
              )}
              {client.concessionaria && <p className={styles.cardDetail}>⚡ {client.concessionaria}</p>}
              <div className={styles.cardActions}>
                <Link href="/documentos?tipo=proposta-bancaria" className={styles.generateBtn}>
                  🏦 Banco
                </Link>
                <button className={styles.editBtn} onClick={() => { setEditingClient(client); setShowModal(true); }}>
                  ✏️ Editar
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(client.id)}
                  disabled={deletingId === client.id}
                >
                  {deletingId === client.id ? '...' : '🗑'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            marginTop: 20,
            flexWrap: 'wrap',
          }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              style={paginationBtnStyle(safePage === 0)}
            >
              ← Anterior
            </button>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '0 8px' }}>
              Página <strong style={{ color: 'var(--color-text)' }}>{safePage + 1}</strong> de {totalPages}
              <span style={{ marginLeft: 8 }}>· {sortedClients.length} no total</span>
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              style={paginationBtnStyle(safePage >= totalPages - 1)}
            >
              Próxima →
            </button>
          </div>
        )}
        </>
      )}

      {showModal && (
        <ClientModal
          client={editingClient}
          onClose={() => { setShowModal(false); setEditingClient(null); }}
          onSave={handleModalSave}
        />
      )}
    </div>
  );
}

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
    opacity: disabled ? 0.5 : 1,
  };
}
