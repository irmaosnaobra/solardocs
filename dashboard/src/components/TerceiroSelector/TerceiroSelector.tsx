'use client';

import { useState, useEffect, useRef } from 'react';
import api from '@/services/api';
import styles from './TerceiroSelector.module.css';

interface Terceiro {
  id: string;
  nome: string;
  tipo: 'PF' | 'PJ';
  cpf_cnpj?: string;
  representante_nome?: string;
  representante_cpf?: string;
  endereco?: string;
  cidade?: string;
  uf?: string;
  email?: string;
  telefone?: string;
  telefone2?: string;
}

interface TerceiroSelectorProps {
  value: string;
  onChange: (terceiroId: string, terceiro: Terceiro | null) => void;
}

export default function TerceiroSelector({ value, onChange }: TerceiroSelectorProps) {
  const [terceiros, setTerceiros] = useState<Terceiro[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Terceiro | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/terceiros').then(({ data }) => setTerceiros(data.terceiros));
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
    if (value && terceiros.length > 0 && !selected) {
      const found = terceiros.find(t => t.id === value);
      if (found) setSelected(found);
    }
  }, [value, terceiros, selected]);

  const filtered = terceiros.filter(t =>
    t.nome.toLowerCase().includes(search.toLowerCase()) ||
    (t.representante_nome || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.cpf_cnpj || '').includes(search)
  );

  function selectTerceiro(t: Terceiro) {
    setSelected(t);
    onChange(t.id, t);
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
              <span className={`${styles.tipoBadge} ${selected.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                {selected.tipo}
              </span>
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
            {(selected.cidade || selected.uf) && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Cidade / UF</span>
                <span className={styles.cardFieldValue}>
                  {[selected.cidade, selected.uf].filter(Boolean).join(' / ')}
                </span>
              </div>
            )}
            {selected.representante_nome && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>Representante</span>
                <span className={styles.cardFieldValue}>{selected.representante_nome}</span>
              </div>
            )}
            {selected.representante_cpf && (
              <div className={styles.cardField}>
                <span className={styles.cardFieldLabel}>CPF Representante</span>
                <span className={styles.cardFieldValue}>{selected.representante_cpf}</span>
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
            {selected.endereco && (
              <div className={`${styles.cardField} ${styles.wide}`}>
                <span className={styles.cardFieldLabel}>Endereço</span>
                <span className={styles.cardFieldValue}>{selected.endereco}</span>
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
            placeholder="Buscar por nome, representante ou CPF/CNPJ..."
            className="input-field"
          />
          {open && (
            <div className={styles.options}>
              {filtered.length > 0 ? filtered.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.option}
                  onClick={() => selectTerceiro(t)}
                >
                  <div className={styles.optionMain}>
                    <span className={styles.optionName}>{t.nome}</span>
                    <span className={`${styles.tipoBadge} ${t.tipo === 'PJ' ? styles.tipoPJ : styles.tipoPF}`}>
                      {t.tipo}
                    </span>
                  </div>
                  <span className={styles.optionDoc}>
                    {[
                      t.cpf_cnpj,
                      t.representante_nome ? `Rep: ${t.representante_nome}` : null,
                      t.cidade ? `${t.cidade}${t.uf ? `/${t.uf}` : ''}` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </button>
              )) : (
                <p className={styles.noResults}>Nenhum terceiro encontrado</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
