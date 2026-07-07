'use client';

import { useState } from 'react';
import api from '@/services/api';
import styles from './ClientModal.module.css';

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

interface ClientModalProps {
  client: Client | null;
  onClose: () => void;
  onSave: (client: Client) => void;
  // seed: pré-preenche o formulário em modo CRIAÇÃO (ex: dados lidos da conta
  // de luz pelo Escanear Conta). Só vale quando client === null; se client tem
  // id, é edição e o seed é ignorado — mantém compatível com os usos existentes.
  seed?: Partial<Client>;
  // notice: aviso opcional no topo do form (ex: consumo detectado / conferir CPF).
  notice?: React.ReactNode;
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

function fmtCep(v: string) {
  return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
}

function fmtTel(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d)/, '($1) $2-$3');
  return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
}

export default function ClientModal({ client, onClose, onSave, seed, notice }: ClientModalProps) {
  // Em edição (client com id) usa o client; em criação, cai no seed (Escanear
  // Conta) e depois no default. seed só influencia o estado inicial.
  const init = client ?? seed ?? null;
  const [form, setForm] = useState({
    tipo: init?.tipo || 'PF' as 'PF' | 'PJ',
    nome: init?.nome || '',
    nacionalidade: init?.nacionalidade || 'brasileiro(a)',
    cpf_cnpj: init?.cpf_cnpj || '',
    endereco: init?.endereco || '',
    cep: init?.cep || '',
    cidade: init?.cidade || '',
    uf: init?.uf || '',
    concessionaria: init?.concessionaria || '',
    email: init?.email || '',
    telefone: init?.telefone || '',
    telefone2: init?.telefone2 || '',
    padrao: init?.padrao || '',
    tipo_telhado: init?.tipo_telhado || '',
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
      let saved: Client;
      if (client) {
        const { data } = await api.put(`/clients/${client.id}`, form);
        saved = data.client;
      } else {
        const { data } = await api.post('/clients', form);
        saved = data.client;
      }
      onSave(saved);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao salvar cliente');
    } finally {
      setSaving(false);
    }
  }

  const isPJ = form.tipo === 'PJ';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{client ? 'Editar cliente' : seed ? 'Revisar dados da conta' : 'Novo cliente'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>

          {notice && (
            <div style={{
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.35)',
              borderRadius: 10,
              padding: '11px 14px',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--color-text, #e2e8f0)',
            }}>
              {notice}
            </div>
          )}

          {/* Tipo PF / PJ */}
          <div className={styles.tipoRow}>
            <button
              type="button"
              className={`${styles.tipoBtn} ${!isPJ ? styles.tipoActive : ''}`}
              onClick={() => set('tipo', 'PF')}
            >
              Pessoa Física
            </button>
            <button
              type="button"
              className={`${styles.tipoBtn} ${isPJ ? styles.tipoActive : ''}`}
              onClick={() => set('tipo', 'PJ')}
            >
              Pessoa Jurídica
            </button>
          </div>

          {/* Nome */}
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

          {/* CPF/CNPJ + Nacionalidade (PF) ou UF (PJ) */}
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
            {!isPJ ? (
              <div className={styles.field}>
                <label className={styles.label}>Nacionalidade</label>
                <input
                  type="text"
                  value={form.nacionalidade}
                  onChange={e => set('nacionalidade', e.target.value)}
                  placeholder="Ex: brasileiro(a)"
                  className="input-field"
                />
              </div>
            ) : (
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
            )}
          </div>

          {/* Endereço */}
          <div className={styles.field}>
            <label className={styles.label}>Endereço Completo</label>
            <input
              type="text"
              value={form.endereco}
              onChange={e => set('endereco', e.target.value)}
              placeholder="Ex: Rua das Flores, 123, Centro"
              className="input-field"
            />
          </div>

          {/* Cidade + CEP */}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Cidade</label>
              <input
                type="text"
                value={form.cidade}
                onChange={e => set('cidade', e.target.value)}
                placeholder="Ex: São Paulo/SP"
                className="input-field"
              />
            </div>
            {!isPJ && (
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
            )}
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>CEP</label>
              <input
                type="text"
                value={form.cep}
                onChange={e => set('cep', fmtCep(e.target.value))}
                placeholder="00000-000"
                className="input-field"
                maxLength={9}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Concessionária</label>
              <input
                type="text"
                value={form.concessionaria}
                onChange={e => set('concessionaria', e.target.value)}
                placeholder="Ex: CEMIG, CPFL, Enel"
                className="input-field"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>E-mail</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="email@exemplo.com"
              className="input-field"
            />
          </div>

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

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Padrão de Energia</label>
              <select value={form.padrao} onChange={e => set('padrao', e.target.value)} className="input-field">
                <option value="">Selecione...</option>
                <option value="Monofásico">Monofásico</option>
                <option value="Bifásico">Bifásico</option>
                <option value="Trifásico">Trifásico</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Tipo de Telhado</label>
              <select value={form.tipo_telhado} onChange={e => set('tipo_telhado', e.target.value)} className="input-field">
                <option value="">Selecione...</option>
                <option value="Fibromadeira">Fibromadeira</option>
                <option value="Fibrometal">Fibrometal</option>
                <option value="Cimento">Cimento</option>
                <option value="Cerâmico">Cerâmico</option>
                <option value="Zinco">Zinco</option>
                <option value="Sanduíche">Sanduíche</option>
                <option value="Solo">Solo</option>
                <option value="Carport">Carport</option>
                <option value="Estrutura Metálica">Estrutura Metálica</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
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
