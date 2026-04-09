'use client';

import { useState, useEffect, useCallback } from 'react';
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
}

export default function ClientesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    try {
      await api.delete(`/clients/${id}`);
      setClients(prev => prev.filter(c => c.id !== id));
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
          <p className={styles.subtitle}>{clients.length} cliente(s) cadastrado(s)</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditingClient(null); setShowModal(true); }}>
          + Novo Cliente
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
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>CPF / CNPJ</th>
                <th>Cidade / UF</th>
                <th>Concessionária</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => (
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
