'use client';

import { useState } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

function todayBR(): string {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function VistoriaPage() {
  const { user } = useDashboard();
  const [clienteId, setClienteId] = useState('');
  const [fields, setFields] = useState({
    data_visita: todayBR(),
    endereco_visita: '',
    tecnico_nome: '',
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) { setError('Selecione um cliente'); return; }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'vistoria',
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
      <h1 className={styles.title}>📋 Vistoria CheckList — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="vistoria"
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
        <h1 className={styles.title}>📋 Vistoria CheckList</h1>
        <p className={styles.subtitle}>Checklist de visita técnica — imprimível em A4 pra preencher na obra</p>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cliente</h2>
          <ClientSelector value={clienteId} onChange={(id, c) => {
            setClienteId(id);
            if (c && !fields.endereco_visita) {
              const partes = [c.endereco, c.cidade, c.uf].filter(Boolean).join(', ');
              if (partes) setFields(f => ({ ...f, endereco_visita: partes }));
            }
          }} />
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados da visita</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Preenchimento mínimo — o checklist vai com boxes em branco pro técnico marcar à mão durante a vistoria.
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Data da visita *</label>
              <input
                type="text"
                value={fields.data_visita}
                onChange={e => setFields({ ...fields, data_visita: e.target.value })}
                placeholder="Ex: 09/05/2026"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Técnico responsável *</label>
              <input
                type="text"
                value={fields.tecnico_nome}
                onChange={e => setFields({ ...fields, tecnico_nome: e.target.value })}
                placeholder="Nome completo + CREA (se houver)"
                className="input-field"
                required
              />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço da visita *</label>
              <input
                type="text"
                value={fields.endereco_visita}
                onChange={e => setFields({ ...fields, endereco_visita: e.target.value })}
                placeholder="Rua, número, bairro, cidade/UF"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteId}>
          {generating ? '⏳ Gerando...' : '📄 Gerar CheckList'}
        </button>
      </form>
    </div>
  );
}
