'use client';

import { useState } from 'react';
import TerceiroSelector from '@/components/TerceiroSelector/TerceiroSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';
import modeStyles from '../contrato-solar/mode.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

const initialFields = {
  percentual_comissao: '',
  foro_cidade: '',
};

type Mode = 'm1' | 'm2' | 'ai';

const MODES: { id: Mode; icon: string; label: string; desc: string; badge?: string }[] = [
  { id: 'm1', icon: '📄', label: 'Pacote Completo', desc: '4 documentos · Contrato + Autonomia + Comissão + Encerramento' },
  { id: 'm2', icon: '📋', label: 'Reforçado', desc: '4 documentos · Linguagem jurídica aprimorada' },
  { id: 'ai', icon: '✨', label: 'Gerar com IA', desc: 'Personalização avançada das cláusulas comerciais', badge: 'PRO' },
];

export default function ContratoPJPage() {
  const { user, openUpgrade } = useDashboard();
  const [mode, setMode] = useState<Mode>('m1');
  const [terceiroId, setTerceiroId] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!terceiroId) { setError('Selecione o vendedor (terceiro)'); return; }

    if (mode === 'ai' && user?.plano === 'free') {
      openUpgrade();
      return;
    }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'contratoPJ',
        terceiro_id: terceiroId,
        fields,
        useTemplate: mode !== 'ai',
        modeloNumero: mode === 'm2' ? 2 : 1,
      });
      setGenerated(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao gerar documento');
    } finally {
      setGenerating(false);
    }
  }

  function handleModeSelect(mId: Mode) {
    if (mId === 'ai' && user?.plano === 'free') {
      openUpgrade();
      return;
    }
    setMode(mId);
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

      <div className={modeStyles.modeSelector}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`${modeStyles.modeBtn} ${mode === m.id ? modeStyles.active : ''} ${m.badge ? modeStyles.hasBadge : ''}`}
            onClick={() => handleModeSelect(m.id)}
          >
            {m.badge && <span className={modeStyles.modeBadge}>{m.badge}</span>}
            <span className={modeStyles.modeIcon}>{m.icon}</span>
            <span className={modeStyles.modeLabel}>{m.label}</span>
            <span className={modeStyles.modeDesc}>{m.desc}</span>
          </button>
        ))}
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
          {generating ? '⏳ Gerando...' : 
            mode === 'ai' ? '✨ Gerar com IA (PRO)' : `📄 Gerar ${mode === 'm1' ? 'Pacote Completo' : 'Pacote Reforçado'}`}
        </button>
      </form>
    </div>
  );
}
