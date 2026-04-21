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
        modeloNumero: 1,
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
          <h2 className={styles.sectionTitle}>Dados da Procuração</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            O engenheiro e o técnico cadastrados em <strong>Empresa</strong> serão inseridos automaticamente como procuradores.
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Unidade Consumidora (UC) *</label>
              <input type="text" value={fields.uc} onChange={e => setFields({...fields, uc: e.target.value})} placeholder="Ex: 266.719.018.52" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Concessionária *</label>
              <input type="text" value={fields.concessionaria} onChange={e => setFields({...fields, concessionaria: e.target.value})} placeholder="Ex: Cemig, CPFL, Enel" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade *</label>
              <input type="text" value={fields.foro_cidade} onChange={e => setFields({...fields, foro_cidade: e.target.value})} placeholder="Ex: Uberlândia" className="input-field" required />
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
