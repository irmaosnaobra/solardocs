'use client';

import { useState, useEffect } from 'react';
import TerceiroSelector from '@/components/TerceiroSelector/TerceiroSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

const initialFields = {
  percentual_comissao: '',
  foro_cidade: '',
};

export default function ContratoPJPage() {
  const { user } = useDashboard();
  const [terceiroId, setTerceiroId] = useState('');
  const [fields, setFields] = useState(initialFields);
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
    if (!terceiroId) { setError('Selecione o vendedor (terceiro)'); return; }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'contratoPJ',
        terceiro_id: terceiroId,
        fields,
        useTemplate: true,
        modeloNumero: 1,
      });
      setGenerated(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao gerar documento');
    } finally {
      setGenerating(false);
    }
  }

  if (generated) return (
    <div className={styles.page}>
      <h1 className={styles.title}>🤝 Contrato PJ Vendas — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="contratoPJ"
        clienteId=""
        terceiroId={terceiroId}
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
        <h1 className={styles.title}>🤝 Contrato PJ Vendas</h1>
        <p className={styles.subtitle}>Pacote completo de documentos para representante comercial PJ</p>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Vendedor / Representante (Terceiro)</h2>
          <TerceiroSelector value={terceiroId} onChange={(id, t) => {
            setTerceiroId(id);
            if (t) setFields(f => ({
              ...f,
              ...(t.cidade && !f.foro_cidade ? { foro_cidade: t.cidade } : {}),
            }));
          }} />
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Condições Comerciais</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Comissão (%) *</label>
              <input
                type="number"
                step="0.01"
                value={fields.percentual_comissao}
                onChange={e => setFields({ ...fields, percentual_comissao: e.target.value })}
                placeholder="Ex: 5"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Foro (cidade) *</label>
              <input
                type="text"
                value={fields.foro_cidade}
                onChange={e => setFields({ ...fields, foro_cidade: e.target.value })}
                placeholder="Ex: Uberlândia"
                className="input-field"
                required
              />
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            A garantia mínima de R$ 1.700,00 e todas as condições de pagamento são inseridas automaticamente nos documentos.
          </p>
        </div>

        {error && <p className="error-message">{error}</p>}
        <button
          type="submit"
          className={`btn-primary ${styles.generateBtn}`}
          disabled={generating || !terceiroId}
        >
          {generating ? '⏳ Gerando...' : '📄 Gerar Contrato PJ'}
        </button>
      </form>
    </div>
  );
}
