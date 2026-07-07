'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';
import TerceiroModal from '@/components/TerceiroModal/TerceiroModal';
import styles from './terceiros.module.css';

interface Terceiro {
  id: string;
  nome: string;
  tipo: 'PF' | 'PJ';
  cpf_cnpj?: string;
  endereco?: string;
  cidade?: string;
  uf?: string;
  representante_nome?: string;
  representante_cpf?: string;
  email?: string;
  telefone?: string;
  telefone2?: string;
}

export default function TerceirosPage() {
  const [terceiros, setTerceiros] = useState<Terceiro[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState<Terceiro | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  const totalPages = Math.max(1, Math.ceil(terceiros.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedTerceiros = terceiros.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search]);

  const fetchTerceiros = useCallback(async (searchTerm?: string) => {
    try {
      const params = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      const { data } = await api.get(`/terceiros${params}`);
      setTerceiros(data.terceiros ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTerceiros(); }, [fetchTerceiros]);

  useEffect(() => {
    const timer = setTimeout(() => fetchTerceiros(search), 300);
    return () => clearTimeout(timer);
  }, [search, fetchTerceiros]);

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este terceiro?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/terceiros/${id}`);
      setTerceiros(prev => prev.filter(t => t.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  function handleSave(t: Terceiro) {
    if (editing) {
      setTerceiros(prev => prev.map(x => x.id === t.id ? t : x));
    } else {
      setTerceiros(prev => [t, ...prev]);
    }
    setShowModal(false);
    setEditing(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Terceiros</h1>
          <p className={styles.subtitle}>
            Parceiros usados em Contratos PJ e Prestação de Serviço · {terceiros.length} {terceiros.length === 1 ? 'cadastrado' : 'cadastrados'}
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + Novo Terceiro
        </button>
      </div>

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
      ) : terceiros.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{search ? 'Nenhum terceiro encontrado.' : 'Nenhum terceiro cadastrado ainda.'}</p>
          {!search && (
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
              Cadastrar primeiro terceiro
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>CPF / CNPJ</th>
                  <th>Cidade / UF</th>
                  <th>Representante</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {pagedTerceiros.map(t => (
                  <tr key={t.id}>
                    <td className={styles.nome}>{t.nome}</td>
                    <td>
                      <span className={`${styles.tipoBadge} ${t.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                        {t.tipo || 'PF'}
                      </span>
                    </td>
                    <td>{t.cpf_cnpj || '—'}</td>
                    <td>{t.cidade ? `${t.cidade}${t.uf ? `/${t.uf}` : ''}` : '—'}</td>
                    <td>{t.representante_nome || '—'}</td>
                    <td>
                      <div className={styles.actions}>
                        <button className={styles.editBtn} onClick={() => { setEditing(t); setShowModal(true); }}>
                          Editar
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(t.id)}
                          disabled={deletingId === t.id}
                        >
                          {deletingId === t.id ? '...' : 'Excluir'}
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
            {pagedTerceiros.map(t => (
              <div key={t.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>{t.nome}</span>
                  <span className={`${styles.tipoBadge} ${t.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                    {t.tipo || 'PF'}
                  </span>
                </div>
                {t.cpf_cnpj && <p className={styles.cardDetail}>{t.cpf_cnpj}</p>}
                {(t.cidade || t.uf) && (
                  <p className={styles.cardDetail}>{t.cidade}{t.uf ? `/${t.uf}` : ''}</p>
                )}
                {t.representante_nome && <p className={styles.cardDetail}>{t.representante_nome}</p>}
                <div className={styles.cardActions}>
                  <button className={styles.editBtn} onClick={() => { setEditing(t); setShowModal(true); }}>
                    Editar
                  </button>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(t.id)}
                    disabled={deletingId === t.id}
                  >
                    {deletingId === t.id ? '...' : 'Excluir'}
                  </button>
                </div>
              </div>
            ))}
          </div>

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
                style={pgBtn(safePage === 0)}
              >
                ← Anterior
              </button>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '0 8px' }}>
                Página <strong style={{ color: 'var(--color-text)' }}>{safePage + 1}</strong> de {totalPages}
                <span style={{ marginLeft: 8 }}>· {terceiros.length} no total</span>
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                style={pgBtn(safePage >= totalPages - 1)}
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}

      {showModal && (
        <TerceiroModal
          terceiro={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function pgBtn(disabled: boolean): React.CSSProperties {
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
