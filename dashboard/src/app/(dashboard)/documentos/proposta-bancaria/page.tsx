'use client';

import { useState } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface Equipamento { item: string; quantidade: number; }
interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

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

const initialEquipamentos: Equipamento[] = [
  { item: 'Módulos Fotovoltaicos', quantidade: 1 },
  { item: 'Micro Inversores', quantidade: 1 },
  { item: 'Kit cabo fotovoltaico', quantidade: 1 },
  { item: 'Kit estrutura telhado', quantidade: 1 },
  { item: 'Kit material elétrico A.C', quantidade: 1 },
  { item: 'Homologação do projeto de engenharia', quantidade: 1 },
  { item: 'Montagem especializada', quantidade: 1 },
];

export default function PropostaBancariaPage() {
  const { } = useDashboard();
  const [clienteId, setClienteId] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>(initialEquipamentos);
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
      <h1 className={styles.title}>🏦 Proposta Bancária — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="propostaBanco"
        clienteId={clienteId}
        clienteNome={generated.cliente_nome}
        dadosJson={{ ...fields, lista_equipamentos: equipamentos }}
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
              <input type="text" value={fields.banco} onChange={e => setFields({...fields, banco: e.target.value})} placeholder="Ex: Santander" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Agência *</label>
              <input type="text" value={fields.agencia} onChange={e => setFields({...fields, agencia: e.target.value})} placeholder="Ex: 3342" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Conta Corrente *</label>
              <input type="text" value={fields.conta} onChange={e => setFields({...fields, conta: e.target.value})} placeholder="Ex: 13009843-0" className="input-field" required />
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
              placeholder="Ex: 12 kWp Sistema Gerador de Energia Fotovoltaica"
              className={styles.textarea}
              required
            />
          </div>

          <label className={styles.label} style={{ marginBottom: 8, display: 'block' }}>Equipamentos *</label>
          <div className={styles.equipmentList}>
            {equipamentos.map((eq, i) => (
              <div key={i} className={styles.equipmentRow}>
                <input
                  type="text"
                  value={eq.item}
                  onChange={e => updateEquipamento(i, 'item', e.target.value)}
                  placeholder="Descrição do item/serviço"
                  className="input-field"
                />
                <input
                  type="number"
                  value={eq.quantidade}
                  onChange={e => updateEquipamento(i, 'quantidade', Number(e.target.value))}
                  placeholder="Qtd"
                  className="input-field"
                  style={{ width: 70 }}
                  min={1}
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
            style={{ marginTop: 8 }}
            onClick={() => setEquipamentos([...equipamentos, { item: '', quantidade: 1 }])}
          >
            + Adicionar item
          </button>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Valores</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Valor Total (R$) *</label>
              <input type="text" value={fields.valor_total} onChange={e => setFields({...fields, valor_total: e.target.value})} placeholder="Ex: 27400,00 (vírgula = decimal)" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Validade (dias) *</label>
              <input type="number" value={fields.validade_dias} onChange={e => setFields({...fields, validade_dias: e.target.value})} placeholder="30" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor Equipamentos (R$)</label>
              <input type="text" value={fields.valor_equipamentos} onChange={e => setFields({...fields, valor_equipamentos: e.target.value})} placeholder="Vazio = 70% do total automático" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor Mão de Obra (R$)</label>
              <input type="text" value={fields.valor_mao_de_obra} onChange={e => setFields({...fields, valor_mao_de_obra: e.target.value})} placeholder="Vazio = 30% do total automático" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Prazo de instalação (dias úteis)</label>
              <input type="number" value={fields.prazo_instalacao_dias} onChange={e => setFields({...fields, prazo_instalacao_dias: e.target.value})} placeholder="30" className="input-field" />
            </div>
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteId}>
          {generating ? '⏳ Gerando...' : '📄 Gerar Proposta Bancária'}
        </button>
      </form>
    </div>
  );
}
