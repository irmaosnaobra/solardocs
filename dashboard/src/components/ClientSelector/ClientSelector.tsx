'use client';

import { useState, useEffect, useRef } from 'react';
import api from '@/services/api';
import styles from './ClientSelector.module.css';

interface Client {
  id: string;
  nome: string;
  tipo?: 'PF' | 'PJ';
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

interface ClientSelectorProps {
  value: string;
  onChange: (clientId: string, client: Client | null) => void;
}

export default function ClientSelector({ value, onChange }: ClientSelectorProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/clients').then(({ data }) => setClients(data.clients));
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (value && clients.length > 0 && !selected) {
      const found = clients.find(c => c.id === value);
      if (found) setSelected(found);
    }
  }, [value, clients, selected]);

  const filtered = clients.filter(c =>
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    (c.cpf_cnpj || '').includes(search)
  );

  function selectClient(client: Client) {
    setSelected(client);
    onChange(client.id, client);
    setOpen(false);
    setSearch('');
  }

  function clear() {
    setSelected(null);
    onChange('', null);
  }

  return (
    <div className={styles.container} ref={containerRef}>
      {selected ? (
        <div className={styles.selectedCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardNameRow}>
              <span className={styles.selectedName}>{selected.nome}</span>
              {selected.tipo && (
                <span className={`${styles.tipoBadge} ${selected.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                  {selected.tipo}
                </span>
              )}
            </div>
            <button type="button" className={styles.changeBtn} onClick={clear}>
              Trocar
            </button>
          </div>

          <div className={styles.cardFields}>
            {selected.cpf_cnpj && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>{selected.tipo === 'PJ' ? 'CNPJ' : 'CPF'}</span>
                <span className={styles.cardFieldValue}>{selected.cpf_cnpj}</span>
              </div>
            )}
            {selected.concessionaria && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Concessionária</span>
                <span className={styles.cardFieldValue}>{selected.concessionaria}</span>
              </div>
            )}
            {(selected.cidade || selected.uf) && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Cidade / UF</span>
                <span className={styles.cardFieldValue}>
                  {[selected.cidade, selected.uf].filter(Boolean).join(' / ')}
                </span>
              </div>
            )}
            {selected.cep && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>CEP</span>
                <span className={styles.cardFieldValue}>{selected.cep}</span>
              </div>
            )}
            {selected.endereco && (
              <div className={`${styles.cardField} ${styles.wide}`}>
                <span className={styles.cardFieldLabel}>Endereço</span>
                <span className={styles.cardFieldValue}>{selected.endereco}</span>
              </div>
            )}
            {selected.nacionalidade && selected.tipo !== 'PJ' && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Nacionalidade</span>
                <span className={styles.cardFieldValue}>{selected.nacionalidade}</span>
              </div>
            )}
            {selected.email && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>E-mail</span>
                <span className={styles.cardFieldValue}>{selected.email}</span>
              </div>
            )}
            {selected.telefone && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Telefone 1</span>
                <span className={styles.cardFieldValue}>{selected.telefone}</span>
              </div>
            )}
            {selected.telefone2 && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Telefone 2</span>
                <span className={styles.cardFieldValue}>{selected.telefone2}</span>
              </div>
            )}
            {selected.padrao && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Padrão</span>
                <span className={styles.cardFieldValue}>{selected.padrao}</span>
              </div>
            )}
            {selected.tipo_telhado && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Telhado</span>
                <span className={styles.cardFieldValue}>{selected.tipo_telhado}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.dropdown}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Buscar cliente pelo nome ou CPF/CNPJ..."
            className="input-field"
          />
          {open && (
            <div className={styles.options}>
              {filtered.length > 0 ? filtered.map(client => (
                <button
                  key={client.id}
                  type="button"
                  className={styles.option}
                  onClick={() => selectClient(client)}
                >
                  <div className={styles.optionMain}>
                    <span className={styles.optionName}>{client.nome}</span>
                    {client.tipo && (
                      <span className={`${styles.tipoBadge} ${client.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                        {client.tipo}
                      </span>
                    )}
                  </div>
                  <span className={styles.optionDoc}>
                    {[
                      client.cpf_cnpj,
                      client.cidade ? `${client.cidade}${client.uf ? `/${client.uf}` : ''}` : null,
                      client.concessionaria,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </button>
              )) : (
                <p className={styles.noResults}>Nenhum cliente encontrado</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
