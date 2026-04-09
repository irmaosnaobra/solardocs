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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Terceiro | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTerceiros = useCallback(async (term?: string) => {
    try {
      const params = term ? `?search=${encodeURIComponent(term)}` : '';
      const { data } = await api.get(`/terceiros${params}`);
      setTerceiros(data.terceiros);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTerceiros(); }, [fetchTerceiros]);

  useEffect(() => {
    const t = setTimeout(() => fetchTerceiros(search), 300);
    return () => clearTimeout(t);
  }, [search, fetchTerceiros]);

  async function handleDelete(id: string) {
    if (!confirm('Excluir este terceiro?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/terceiros/${id}`);
      setTerceiros(prev => prev.filter(t => t.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  function handleModalSave(t: Terceiro) {
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
            Empresas e pessoas usadas em Contratos PJ e Prestação de Serviço · {terceiros.length} cadastrado(s)
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
          placeholder="Buscar por nome ou representante..."
          className="input-field"
        />
      </div>

      {loading ? (
        <p className={styles.empty}>Carregando...</p>
      ) : terceiros.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>🤝</span>
          <p>{search ? 'Nenhum terceiro encontrado.' : 'Nenhum terceiro cadastrado ainda.'}</p>
          {!search && (
            <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
              Cadastrar primeiro terceiro
            </button>
          )}
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome / Razão Social</th>
                <th>Tipo</th>
                <th>CPF / CNPJ</th>
                <th>Representante</th>
                <th>Cidade</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {terceiros.map(t => (
                <tr key={t.id}>
                  <td className={styles.nome}>{t.nome}</td>
                  <td>
                    <span className={`${styles.tipoBadge} ${t.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                      {t.tipo}
                    </span>
                  </td>
                  <td>{t.cpf_cnpj || '—'}</td>
                  <td>{t.representante_nome || '—'}</td>
                  <td>{t.cidade ? `${t.cidade}${t.uf ? `/${t.uf}` : ''}` : '—'}</td>
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
      )}

      {showModal && (
        <TerceiroModal
          terceiro={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={handleModalSave}
        />
      )}
    </div>
  );
}
