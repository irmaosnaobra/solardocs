'use client';

import { useState } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';
import modeStyles from '../contrato-solar/mode.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; }

type Mode = 'm1' | 'm2' | 'ai';

const MODES: { id: Mode; icon: string; label: string; desc: string; badge?: string }[] = [
  { id: 'm1', icon: '📄', label: 'Modelo 1', desc: 'Padrão · Formato direto' },
  { id: 'm2', icon: '📋', label: 'Modelo 2', desc: 'Formal · Poderes especiais detalhados' },
  { id: 'ai', icon: '✨', label: 'Gerar com IA', desc: 'Personalização inteligente dos poderes', badge: 'PRO' },
];

export default function ProcuracaoPage() {
  const { user, openUpgrade } = useDashboard();
  const [mode, setMode] = useState<Mode>('m1');
  const [clienteId, setClienteId] = useState('');
  const [fields, setFields] = useState({
    uc: '',
    concessionaria: '',
    foro_cidade: '',
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) { setError('Selecione um cliente'); return; }

    if (mode === 'ai' && user?.plano === 'free') {
      openUpgrade();
      return;
    }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'procuracao',
        cliente_id: clienteId,
        fields,
        useTemplate: mode !== 'ai',
        modeloNumero: mode === 'm2' ? 2 : 1,
      });
      setGenerated(data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Erro ao gerar documento');
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
      <h1 className={styles.title}>📜 Procuração — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="procuracao"
        clienteId={clienteId}
        clienteNome={generated.cliente_nome}
        dadosJson={fields}
        modeloUsado={generated.modelo_usado}
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
          {generating ? '⏳ Gerando...' : 
            mode === 'ai' ? '✨ Gerar com IA (PRO)' : `📄 Gerar ${mode === 'm2' ? 'Modelo 2' : 'Modelo 1'}`}
        </button>
      </form>
    </div>
  );
}
