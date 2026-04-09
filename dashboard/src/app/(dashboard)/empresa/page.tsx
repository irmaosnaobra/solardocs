'use client';

import { useState, useEffect, useRef } from 'react';
import api from '@/services/api';
import styles from './empresa.module.css';

interface Company {
  id: string;
  nome: string;
  cnpj: string;
  endereco?: string;
  logo_base64?: string;
  socio_adm?: string;
  engenheiro_nome?: string;
  engenheiro_cpf?: string;
  engenheiro_crea?: string;
  engenheiro_rg?: string;
  engenheiro_nacionalidade?: string;
  engenheiro_estado_civil?: string;
  engenheiro_profissao?: string;
  engenheiro_endereco?: string;
  tecnico_nome?: string;
  tecnico_cpf?: string;
  tecnico_rg?: string;
  tecnico_nacionalidade?: string;
  tecnico_estado_civil?: string;
  tecnico_endereco?: string;
}

const emptyForm = {
  nome: '', cnpj: '', endereco: '', logo_base64: '', socio_adm: '',
  engenheiro_nome: '', engenheiro_cpf: '', engenheiro_crea: '',
  engenheiro_rg: '', engenheiro_nacionalidade: '', engenheiro_estado_civil: '', engenheiro_profissao: '',
  engenheiro_endereco: '',
  tecnico_nome: '', tecnico_cpf: '',
  tecnico_rg: '', tecnico_nacionalidade: '', tecnico_estado_civil: '',
  tecnico_endereco: '',
};

function fmtCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function fmtCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

/** Valida dígitos verificadores do CNPJ */
function validaCnpjDigitos(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false; // todos iguais

  const calcDigit = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(base[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return (
    calcDigit(c, [5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(c[12]) &&
    calcDigit(c, [6,5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(c[13])
  );
}

type CnpjStatus = 'idle' | 'checking' | 'valid' | 'invalid';

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className={styles.infoItem}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={styles.infoValue}>{value}</span>
    </div>
  );
}

export default function EmpresaPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [cnpjStatus, setCnpjStatus] = useState<CnpjStatus>('idle');
  const [cnpjError, setCnpjError] = useState('');
  // CNPJ que já foi validado nesta sessão de edição
  const validatedCnpjRef = useRef('');

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company) {
        const c = data.company;
        setCompany(c);
        setForm({
          nome: c.nome || '', cnpj: c.cnpj || '', endereco: c.endereco || '',
          logo_base64: c.logo_base64 || '', socio_adm: c.socio_adm || '',
          engenheiro_nome: c.engenheiro_nome || '', engenheiro_cpf: c.engenheiro_cpf || '',
          engenheiro_crea: c.engenheiro_crea || '', engenheiro_rg: c.engenheiro_rg || '',
          engenheiro_nacionalidade: c.engenheiro_nacionalidade || '', engenheiro_estado_civil: c.engenheiro_estado_civil || '',
          engenheiro_profissao: c.engenheiro_profissao || '', engenheiro_endereco: c.engenheiro_endereco || '',
          tecnico_nome: c.tecnico_nome || '', tecnico_cpf: c.tecnico_cpf || '',
          tecnico_rg: c.tecnico_rg || '', tecnico_nacionalidade: c.tecnico_nacionalidade || '',
          tecnico_estado_civil: c.tecnico_estado_civil || '', tecnico_endereco: c.tecnico_endereco || '',
        });
        // CNPJ já salvo é considerado válido
        if (c.cnpj) {
          setCnpjStatus('valid');
          validatedCnpjRef.current = c.cnpj.replace(/\D/g, '');
        }
      } else {
        setEditing(true);
      }
    }).finally(() => setLoading(false));
  }, []);

  function set(field: keyof typeof emptyForm, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleCnpjChange(raw: string) {
    const formatted = fmtCnpj(raw);
    set('cnpj', formatted);
    const digits = formatted.replace(/\D/g, '');
    // Resetar status se o usuário alterou o CNPJ
    if (digits !== validatedCnpjRef.current) {
      setCnpjStatus('idle');
      setCnpjError('');
    }
  }

  async function handleCnpjBlur() {
    const digits = form.cnpj.replace(/\D/g, '');

    // Já validado e não mudou
    if (digits === validatedCnpjRef.current && cnpjStatus === 'valid') return;
    if (digits.length < 14) return;

    if (!validaCnpjDigitos(digits)) {
      setCnpjStatus('invalid');
      setCnpjError('CNPJ inválido — verifique os dígitos informados.');
      return;
    }

    setCnpjStatus('checking');
    setCnpjError('');

    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) {
        setCnpjStatus('invalid');
        setCnpjError('CNPJ não encontrado na Receita Federal.');
        return;
      }
      const data = await res.json();
      setCnpjStatus('valid');
      validatedCnpjRef.current = digits;

      // Preenche razão social automaticamente se o campo estiver vazio
      if (!form.nome && data.razao_social) {
        set('nome', data.razao_social);
      }
    } catch {
      setCnpjStatus('invalid');
      setCnpjError('Não foi possível consultar o CNPJ. Verifique sua conexão.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (cnpjStatus !== 'valid') {
      setMessage({ type: 'error', text: 'Confirme um CNPJ válido antes de salvar.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const method = company ? 'put' : 'post';
      const { data } = await api[method]('/company', form);
      setCompany(data.company);
      setEditing(false);
      setMessage({ type: 'success', text: 'Empresa salva com sucesso!' });
      setTimeout(() => setMessage(null), 3000);
      // Notifica o layout para desbloquear a sidebar
      window.dispatchEvent(new CustomEvent('company-saved'));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setMessage({ type: 'error', text: error.response?.data?.error || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.loading}>Carregando...</div>;

  // ── VIEW ─────────────────────────────────────────────────
  if (company && !editing) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Minha Empresa</h1>
            <p className={styles.subtitle}>Dados usados automaticamente em todos os documentos</p>
          </div>
          <button className="btn-secondary" onClick={() => setEditing(true)}>Editar</button>
        </div>

        {message && (
          <p className={message.type === 'error' ? 'error-message' : 'success-message'} style={{ marginBottom: 16 }}>
            {message.text}
          </p>
        )}

        <div className={styles.sections}>
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Dados da Empresa</h2>
            {company.logo_base64 && (
              <div className={styles.logoPreviewWrap}>
                <img src={company.logo_base64} alt="Logo" className={styles.logoPreview} />
              </div>
            )}
            <div className={styles.infoGrid}>
              <InfoRow label="Razão Social" value={company.nome} />
              <InfoRow label="CNPJ" value={company.cnpj} />
              <InfoRow label="Endereço Completo" value={company.endereco} />
              <InfoRow label="Sócio Administrador" value={company.socio_adm} />
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Engenheiro Responsável</h2>
            {company.engenheiro_nome ? (
              <div className={styles.infoGrid}>
                <InfoRow label="Nome" value={company.engenheiro_nome} />
                <InfoRow label="Profissão" value={company.engenheiro_profissao} />
                <InfoRow label="Nacionalidade" value={company.engenheiro_nacionalidade} />
                <InfoRow label="Estado Civil" value={company.engenheiro_estado_civil} />
                <InfoRow label="CPF" value={company.engenheiro_cpf} />
                <InfoRow label="RG" value={company.engenheiro_rg} />
                <InfoRow label="CREA" value={company.engenheiro_crea} />
                <InfoRow label="Endereço" value={company.engenheiro_endereco} />
              </div>
            ) : (
              <p className={styles.emptySection}>Nenhum engenheiro cadastrado</p>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Técnico Responsável</h2>
            {company.tecnico_nome ? (
              <div className={styles.infoGrid}>
                <InfoRow label="Nome" value={company.tecnico_nome} />
                <InfoRow label="Nacionalidade" value={company.tecnico_nacionalidade} />
                <InfoRow label="Estado Civil" value={company.tecnico_estado_civil} />
                <InfoRow label="CPF" value={company.tecnico_cpf} />
                <InfoRow label="RG" value={company.tecnico_rg} />
                <InfoRow label="Endereço" value={company.tecnico_endereco} />
              </div>
            ) : (
              <p className={styles.emptySection}>Nenhum técnico cadastrado</p>
            )}
          </section>
        </div>
      </div>
    );
  }

  // ── CNPJ status helpers ────────────────────────────────────
  const cnpjHint =
    cnpjStatus === 'checking' ? { color: 'var(--color-text-muted)', text: 'Consultando Receita Federal...' } :
    cnpjStatus === 'valid'    ? { color: '#22c55e', text: '✓ CNPJ válido e encontrado na Receita Federal' } :
    cnpjStatus === 'invalid'  ? { color: '#ef4444', text: `✗ ${cnpjError}` } :
    null;

  // ── EDIT ─────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{company ? 'Editar Empresa' : 'Cadastrar Empresa'}</h1>
          <p className={styles.subtitle}>Dados usados automaticamente em todos os documentos</p>
        </div>
        {company && (
          <button className="btn-secondary" onClick={() => setEditing(false)}>Cancelar</button>
        )}
      </div>

      {!company && (
        <div style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 20,
          fontSize: 13.5,
          color: 'var(--color-text-muted)',
        }}>
          Cadastre o CNPJ da sua empresa para liberar o acesso ao sistema.
          O CNPJ será verificado na Receita Federal automaticamente.
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Dados da Empresa</h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Logo da empresa</label>
              <div className={styles.logoUploadArea}>
                {form.logo_base64 && (
                  <img src={form.logo_base64} alt="Logo" className={styles.logoPreview} />
                )}
                <div className={styles.logoUploadActions}>
                  <label className={styles.uploadBtn}>
                    {form.logo_base64 ? 'Trocar logo' : '+ Fazer upload do logo'}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 500 * 1024) {
                          alert('Arquivo muito grande. Use uma imagem menor que 500KB.');
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = (ev) => set('logo_base64', ev.target?.result as string);
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  {form.logo_base64 && (
                    <button type="button" className={styles.removeLogo} onClick={() => set('logo_base64', '')}>
                      Remover
                    </button>
                  )}
                </div>
                <span className={styles.logoHint}>
                  PNG com fundo transparente · tamanho ideal <strong>400 × 150 px</strong> · máx. 500 KB
                </span>
                <span className={styles.logoHint}>
                  <a
                    href="https://www.iloveimg.com/resize-image#resize-options,width:400,height:150"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.logoHintLink}
                  >
                    ✦ Clique aqui para redimensionar sua logo gratuitamente
                  </a>
                  {' '}— ao abrir, confirme <strong>400 × 150 px</strong>, baixe e faça o upload acima.
                </span>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>CNPJ *</label>
              <input
                type="text"
                value={form.cnpj}
                onChange={e => handleCnpjChange(e.target.value)}
                onBlur={handleCnpjBlur}
                placeholder="00.000.000/0000-00"
                className="input-field"
                required
                maxLength={18}
              />
              {cnpjHint && (
                <span style={{ fontSize: 12, color: cnpjHint.color, marginTop: 4, display: 'block' }}>
                  {cnpjHint.text}
                </span>
              )}
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Razão Social *</label>
              <input type="text" value={form.nome} onChange={e => set('nome', e.target.value)}
                placeholder="Preenchido automaticamente após validar o CNPJ" className="input-field" required />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Sócio Administrador</label>
              <input type="text" value={form.socio_adm} onChange={e => set('socio_adm', e.target.value)}
                placeholder="Nome do sócio administrador" className="input-field" />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço Completo</label>
              <input type="text" value={form.endereco} onChange={e => set('endereco', e.target.value)}
                placeholder="Rua, número, bairro, cidade — UF, CEP" className="input-field" />
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Engenheiro Responsável <span className={styles.optional}>opcional</span></h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome completo</label>
              <input type="text" value={form.engenheiro_nome} onChange={e => set('engenheiro_nome', e.target.value)}
                placeholder="Nome completo" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Profissão</label>
              <input type="text" value={form.engenheiro_profissao} onChange={e => set('engenheiro_profissao', e.target.value)}
                placeholder="Ex: engenheiro eletricista" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Nacionalidade</label>
              <input type="text" value={form.engenheiro_nacionalidade} onChange={e => set('engenheiro_nacionalidade', e.target.value)}
                placeholder="Ex: brasileiro" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Estado Civil</label>
              <input type="text" value={form.engenheiro_estado_civil} onChange={e => set('engenheiro_estado_civil', e.target.value)}
                placeholder="Ex: solteiro, casado" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CPF</label>
              <input type="text" value={form.engenheiro_cpf} onChange={e => set('engenheiro_cpf', fmtCpf(e.target.value))}
                placeholder="000.000.000-00" className="input-field" maxLength={14} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>RG</label>
              <input type="text" value={form.engenheiro_rg} onChange={e => set('engenheiro_rg', e.target.value)}
                placeholder="Ex: 3.176.474" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CREA</label>
              <input type="text" value={form.engenheiro_crea} onChange={e => set('engenheiro_crea', e.target.value)}
                placeholder="Ex: CREA-DF sob o n° 27202" className="input-field" />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço</label>
              <input type="text" value={form.engenheiro_endereco} onChange={e => set('engenheiro_endereco', e.target.value)}
                placeholder="cidade de ..., à Rua ..." className="input-field" />
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Técnico Responsável <span className={styles.optional}>opcional</span></h2>
          <div className={styles.grid2}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Nome completo</label>
              <input type="text" value={form.tecnico_nome} onChange={e => set('tecnico_nome', e.target.value)}
                placeholder="Nome completo" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Nacionalidade</label>
              <input type="text" value={form.tecnico_nacionalidade} onChange={e => set('tecnico_nacionalidade', e.target.value)}
                placeholder="Ex: brasileiro" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Estado Civil</label>
              <input type="text" value={form.tecnico_estado_civil} onChange={e => set('tecnico_estado_civil', e.target.value)}
                placeholder="Ex: casado" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>CPF</label>
              <input type="text" value={form.tecnico_cpf} onChange={e => set('tecnico_cpf', fmtCpf(e.target.value))}
                placeholder="000.000.000-00" className="input-field" maxLength={14} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>RG</label>
              <input type="text" value={form.tecnico_rg} onChange={e => set('tecnico_rg', e.target.value)}
                placeholder="Ex: 2.456.789" className="input-field" />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço</label>
              <input type="text" value={form.tecnico_endereco} onChange={e => set('tecnico_endereco', e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF" className="input-field" />
            </div>
          </div>
        </section>

        {message && (
          <p className={message.type === 'error' ? 'error-message' : 'success-message'}>{message.text}</p>
        )}

        <div className={styles.saveBar}>
          {company && (
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancelar</button>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || cnpjStatus === 'checking' || cnpjStatus === 'invalid'}
            title={cnpjStatus !== 'valid' ? 'Valide o CNPJ antes de salvar' : undefined}
          >
            {saving ? 'Salvando...' : company ? 'Salvar alterações' : 'Cadastrar empresa'}
          </button>
        </div>
      </form>
    </div>
  );
}
