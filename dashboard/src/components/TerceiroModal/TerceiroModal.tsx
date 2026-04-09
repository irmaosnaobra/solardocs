'use client';

import { useState } from 'react';
import api from '@/services/api';
import styles from './TerceiroModal.module.css';

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

interface TerceiroModalProps {
  terceiro: Terceiro | null;
  onClose: () => void;
  onSave: (terceiro: Terceiro) => void;
}

function fmtCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function fmtCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function fmtTel(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d)/, '($1) $2-$3');
  return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
}

export default function TerceiroModal({ terceiro, onClose, onSave }: TerceiroModalProps) {
  const [form, setForm] = useState({
    tipo: terceiro?.tipo || 'PJ' as 'PF' | 'PJ',
    nome: terceiro?.nome || '',
    cpf_cnpj: terceiro?.cpf_cnpj || '',
    endereco: terceiro?.endereco || '',
    cidade: terceiro?.cidade || '',
    uf: terceiro?.uf || '',
    representante_nome: terceiro?.representante_nome || '',
    representante_cpf: terceiro?.representante_cpf || '',
    email: terceiro?.email || '',
    telefone: terceiro?.telefone || '',
    telefone2: terceiro?.telefone2 || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set<K extends keyof typeof form>(field: K, value: typeof form[K]) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleCpfCnpj(v: string) {
    set('cpf_cnpj', form.tipo === 'PJ' ? fmtCnpj(v) : fmtCpf(v));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let saved: Terceiro;
      if (terceiro) {
        const { data } = await api.put(`/terceiros/${terceiro.id}`, form);
        saved = data.terceiro;
      } else {
        const { data } = await api.post('/terceiros', form);
        saved = data.terceiro;
      }
      onSave(saved);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  const isPJ = form.tipo === 'PJ';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{terceiro ? 'Editar terceiro' : 'Novo terceiro'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>

          {/* Tipo */}
          <div className={styles.tipoRow}>
            <button
              type="button"
              className={`${styles.tipoBtn} ${isPJ ? styles.tipoActive : ''}`}
              onClick={() => set('tipo', 'PJ')}
            >
              🏢 Pessoa Jurídica
            </button>
            <button
              type="button"
              className={`${styles.tipoBtn} ${!isPJ ? styles.tipoActive : ''}`}
              onClick={() => set('tipo', 'PF')}
            >
              👤 Pessoa Física
            </button>
          </div>

          {/* Nome / Razão Social */}
          <div className={styles.field}>
            <label className={styles.label}>{isPJ ? 'Razão Social *' : 'Nome Completo *'}</label>
            <input
              type="text"
              value={form.nome}
              onChange={e => set('nome', e.target.value)}
              placeholder={isPJ ? 'Nome da empresa' : 'Nome completo'}
              className="input-field"
              required
            />
          </div>

          {/* CPF / CNPJ */}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>{isPJ ? 'CNPJ' : 'CPF'}</label>
              <input
                type="text"
                value={form.cpf_cnpj}
                onChange={e => handleCpfCnpj(e.target.value)}
                placeholder={isPJ ? '00.000.000/0000-00' : '000.000.000-00'}
                className="input-field"
                maxLength={isPJ ? 18 : 14}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>UF</label>
              <input
                type="text"
                value={form.uf}
                onChange={e => set('uf', e.target.value.toUpperCase().slice(0, 2))}
                placeholder="MG"
                className="input-field"
                maxLength={2}
              />
            </div>
          </div>

          {/* Endereço + Cidade */}
          <div className={styles.field}>
            <label className={styles.label}>Endereço Completo</label>
            <input
              type="text"
              value={form.endereco}
              onChange={e => set('endereco', e.target.value)}
              placeholder="Rua, número, bairro, cidade — UF"
              className="input-field"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Cidade</label>
            <input
              type="text"
              value={form.cidade}
              onChange={e => set('cidade', e.target.value)}
              placeholder="Ex: Uberlândia"
              className="input-field"
            />
          </div>

          {/* Representante (PJ only) */}
          {isPJ && (
            <>
              <div className={styles.sectionLabel}>Representante Legal</div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Nome do Representante</label>
                  <input
                    type="text"
                    value={form.representante_nome}
                    onChange={e => set('representante_nome', e.target.value)}
                    placeholder="Nome completo"
                    className="input-field"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>CPF do Representante</label>
                  <input
                    type="text"
                    value={form.representante_cpf}
                    onChange={e => set('representante_cpf', fmtCpf(e.target.value))}
                    placeholder="000.000.000-00"
                    className="input-field"
                    maxLength={14}
                  />
                </div>
              </div>
            </>
          )}

          {/* Contato */}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Telefone 1</label>
              <input
                type="text"
                value={form.telefone}
                onChange={e => set('telefone', fmtTel(e.target.value))}
                placeholder="(00) 00000-0000"
                className="input-field"
                maxLength={15}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Telefone 2</label>
              <input
                type="text"
                value={form.telefone2}
                onChange={e => set('telefone2', fmtTel(e.target.value))}
                placeholder="(00) 00000-0000"
                className="input-field"
                maxLength={15}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>E-mail</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="email@empresa.com"
              className="input-field"
            />
          </div>

          {error && <p className="error-message">{error}</p>}

          <div className={styles.actions}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
