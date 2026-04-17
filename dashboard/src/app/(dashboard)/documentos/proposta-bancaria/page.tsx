'use client';

import { useState } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';
import modeStyles from '../contrato-solar/mode.module.css';

interface Equipamento { item: string; quantidade: number; valor: number; }
interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

type Mode = 'm1' | 'm2' | 'ai';

const MODES: { id: Mode; icon: string; label: string; desc: string; badge?: string }[] = [
  { id: 'm1', icon: '📄', label: 'Modelo 1', desc: 'Padrão · Seu formato atual' },
  { id: 'm2', icon: '📋', label: 'Modelo 2', desc: 'Formal · Carta + declarações' },
  { id: 'ai', icon: '✨', label: 'Gerar com IA', desc: 'Personalização técnica para o banco', badge: 'PRO' },
];

const initialFields = {
  banco: '',
  agencia: '',
  conta: '',
  concessionaria: '',
  descricao_sistema: '',
  valor_total: '',
  valor_equipamentos: '',
  valor_mao_de_obra: '',
  validade_dias: '30',
  prazo_instalacao_dias: '30',
};

export default function PropostaBancariaPage() {
  const { user, openUpgrade } = useDashboard();
  const [mode, setMode] = useState<Mode>('m1');
  const [clienteId, setClienteId] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([{ item: '', quantidade: 1, valor: 0 }]);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  function updateEquipamento(index: number, key: keyof Equipamento, value: string | number) {
    const arr = [...equipamentos];
    arr[index] = { ...arr[index], [key]: value };
    setEquipamentos(arr);
  }

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
        tipo: 'propostaBanco',
        cliente_id: clienteId,
        fields: { ...fields, lista_equipamentos: equipamentos },
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
      <h1 className={styles.title}>🏦 Proposta Bancária — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="propostaBanco"
        clienteId={clienteId}
        clienteNome={generated.cliente_nome}
        dadosJson={{...fields, lista_equipamentos: equipamentos}}
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
        <h1 className={styles.title}>🏦 Proposta Bancária</h1>
        <p className={styles.subtitle}>Proposta técnica e comercial para financiamento</p>
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
          <h2 className={styles.sectionTitle}>Cliente</h2>
          <ClientSelector value={clienteId} onChange={(id, c) => {
            setClienteId(id);
            if (c) {
              setFields(f => ({
                ...f,
                ...(c.concessionaria && !f.concessionaria ? { concessionaria: c.concessionaria } : {}),
              }));
            }
          }} />
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados Bancários</h2>
          <div className={styles.grid3}>
            <div className={styles.field}>
              <label className={styles.label}>Banco *</label>
              <input type="text" value={fields.banco} onChange={e => setFields({...fields, banco: e.target.value})} placeholder="Ex: 756 SICOOB ARACOOP" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Agência *</label>
              <input type="text" value={fields.agencia} onChange={e => setFields({...fields, agencia: e.target.value})} placeholder="Ex: 4264" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Conta Corrente *</label>
              <input type="text" value={fields.conta} onChange={e => setFields({...fields, conta: e.target.value})} placeholder="Ex: 168882" className="input-field" required />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Concessionária *</label>
            <input type="text" value={fields.concessionaria} onChange={e => setFields({...fields, concessionaria: e.target.value})} placeholder="Ex: Cemig, CPFL, Enel" className="input-field" required />
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Sistema Solar</h2>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Descrição do sistema *</label>
            <textarea
              value={fields.descricao_sistema}
              onChange={e => setFields({...fields, descricao_sistema: e.target.value})}
              placeholder="Ex: 2,8 kWp SISTEMA GERADOR DE ENERGIA SOLAR FOTOVOLTAICA"
              className={styles.textarea}
              required
            />
          </div>
          <div>
            <label className={styles.label} style={{marginBottom: 8, display: 'block'}}>Equipamentos *</label>
            <div className={styles.equipmentList}>
              {equipamentos.map((eq, i) => (
                <div key={i} className={styles.equipmentRow}>
                  <input
                    type="text"
                    value={eq.item}
                    onChange={e => updateEquipamento(i, 'item', e.target.value)}
                    placeholder="Descrição do equipamento/serviço"
                    className="input-field"
                  />
                  <input
                    type="number"
                    value={eq.quantidade}
                    onChange={e => updateEquipamento(i, 'quantidade', Number(e.target.value))}
                    placeholder="Qtd"
                    className="input-field"
                    style={{width: 70}}
                    min={1}
                  />
                  <input
                    type="number"
                    value={eq.valor || ''}
                    onChange={e => updateEquipamento(i, 'valor', Number(e.target.value))}
                    placeholder="Valor unit."
                    className="input-field"
                    style={{width: 120}}
                    min={0}
                    step="0.01"
                  />
                  {equipamentos.length > 1 && (
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => setEquipamentos(equipamentos.filter((_, j) => j !== i))}
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className={styles.addItemBtn}
              style={{marginTop: 8}}
              onClick={() => setEquipamentos([...equipamentos, { item: '', quantidade: 1, valor: 0 }])}
            >
              + Adicionar equipamento
            </button>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Valores</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Valor Total (R$) *</label>
              <input type="text" value={fields.valor_total} onChange={e => setFields({...fields, valor_total: e.target.value})} placeholder="Ex: 7.280,00" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Validade (dias) *</label>
              <input type="number" value={fields.validade_dias} onChange={e => setFields({...fields, validade_dias: e.target.value})} placeholder="30" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor Equipamentos (R$)</label>
              <input type="text" value={fields.valor_equipamentos} onChange={e => setFields({...fields, valor_equipamentos: e.target.value})} placeholder="Deixe vazio para 70% automático" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor Mão de Obra (R$)</label>
              <input type="text" value={fields.valor_mao_de_obra} onChange={e => setFields({...fields, valor_mao_de_obra: e.target.value})} placeholder="Deixe vazio para 30% automático" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Prazo de instalação (dias úteis)</label>
              <input type="number" value={fields.prazo_instalacao_dias} onChange={e => setFields({...fields, prazo_instalacao_dias: e.target.value})} placeholder="30" className="input-field" />
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

