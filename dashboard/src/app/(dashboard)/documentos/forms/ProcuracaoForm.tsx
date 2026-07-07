'use client';

import { useState, useEffect } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

export default function ProcuracaoPage() {
  const { user } = useDashboard();
  const [clienteId, setClienteId] = useState('');
  const [modelo, setModelo] = useState<1 | 2 | 3>(1);
  const [fields, setFields] = useState({
    uc: '',
    concessionaria: '',
    foro_cidade: '',
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company?.cidade) setFields(f => ({ ...f, foro_cidade: f.foro_cidade || data.company.cidade }));
    }).catch(() => {});
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) { setError('Selecione um cliente'); return; }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'procuracao',
        cliente_id: clienteId,
        fields,
        useTemplate: true,
        modeloNumero: modelo,
      });
      setGenerated(data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Erro ao gerar documento');
    } finally {
      setGenerating(false);
    }
  }

  if (generated) return (
    <div className={styles.page}>
      <h1 className={styles.title}>📜 Procuração — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="procuracao"
        clienteId={clienteId}
        clienteNome={generated.cliente_nome}
        dadosJson={fields}
        modeloUsado={generated.modelo_usado}
        docId={generated.doc_id}
        userPlano={user?.plano}
        onNewGeneration={() => setGenerated(null)}
      />
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>📜 Procuração</h1>
        <p className={styles.subtitle}>Procuração para concessionária — assinada pelo cliente</p>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Outorgante (Cliente)</h2>
          <ClientSelector value={clienteId} onChange={(id, c) => {
            setClienteId(id);
            if (c) {
              setFields(f => ({
                ...f,
                ...(c.concessionaria && !f.concessionaria ? { concessionaria: c.concessionaria } : {}),
                ...(c.cidade && !f.foro_cidade ? { foro_cidade: c.cidade } : {}),
              }));
            }
          }} />
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Modelo de Procuração</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { n: 1, titulo: 'Modelo 1 — Padrão',     desc: 'Formato direto, eng. + técnico'   },
              { n: 2, titulo: 'Modelo 2 — Jurídico',   desc: 'Instrumento particular formal'    },
              { n: 3, titulo: 'Modelo 3 — ANEEL',      desc: 'Empresa outorgada + 4 procuradores (eng. + 3 técnicos)' },
            ].map(opt => {
              const selected = modelo === opt.n;
              return (
                <button
                  key={opt.n}
                  type="button"
                  onClick={() => setModelo(opt.n as 1 | 2 | 3)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: selected ? '2px solid var(--color-primary, #16a34a)' : '1px solid var(--color-border, #e2e8f0)',
                    background: selected ? 'rgba(22,163,74,0.08)' : 'var(--color-surface, #fff)',
                    cursor: 'pointer',
                    color: 'inherit',
                    transition: 'border-color 120ms, background 120ms',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{opt.titulo}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados da Procuração</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            {modelo === 3
              ? <>O engenheiro e os técnicos (1, 2 e 3) cadastrados em <strong>Empresa</strong> serão listados como procuradores automaticamente.</>
              : <>O engenheiro e o técnico cadastrados em <strong>Empresa</strong> serão inseridos automaticamente como procuradores.</>}
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Unidade Consumidora (UC) *</label>
              <input type="text" value={fields.uc} onChange={e => setFields({...fields, uc: e.target.value})} placeholder="Ex: 100.200.300.40" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Concessionária *</label>
              <input type="text" value={fields.concessionaria} onChange={e => setFields({...fields, concessionaria: e.target.value})} placeholder="Ex: Cemig, CPFL, Enel" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade *</label>
              <input type="text" value={fields.foro_cidade} onChange={e => setFields({...fields, foro_cidade: e.target.value})} placeholder="Ex: São Paulo" className="input-field" required />
            </div>
          </div>
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteId}>
          {generating ? '⏳ Gerando...' : '📄 Gerar Procuração'}
        </button>
      </form>
    </div>
  );
}
