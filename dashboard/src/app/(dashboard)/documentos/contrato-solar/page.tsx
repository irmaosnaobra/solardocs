'use client';

import { useState } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';
import modeStyles from './mode.module.css';

interface Client {
  id: string;
  nome: string;
  cpf_cnpj?: string;
  endereco?: string;
  cep?: string;
  cidade?: string;
}

interface GeneratedDoc {
  content: string;
  modelo_usado: string;
  cliente_nome: string;
}

const initialFields = {
  potencia_kwp: '',
  quantidade_modulos: '',
  marca_modulos: '',
  quantidade_inversores: '',
  tipo_inversor: '',
  marca_inversor: '',
  valor_total: '',
  condicoes_pagamento: '',
  prazo_projeto_dias: '5',
  prazo_aprovacao_dias: '40',
  prazo_instalacao_dias: '10',
  garantia_modulos_anos: '',
  garantia_inversor_anos: '',
  garantia_instalacao_anos: '',
  endereco_instalacao: '',
  foro_cidade: '',
};

type Mode = 'm1' | 'm2' | 'ai';

const MODES: { id: Mode; icon: string; label: string; desc: string; badge?: string }[] = [
  { id: 'm1', icon: '📄', label: 'Modelo 1', desc: 'Profissional · 15 seções · Linguagem clara e comercial' },
  { id: 'm2', icon: '📋', label: 'Modelo 2', desc: 'Formal · 15 cláusulas numeradas · Mais detalhado' },
  { id: 'ai', icon: '✨', label: 'Gerar com IA', desc: 'Personalização total baseada no seu perfil e cliente', badge: 'PRO' },
];

export default function ContratoSolarPage() {
  const { user, openUpgrade } = useDashboard();
  const [mode, setMode] = useState<Mode>('m1');
  const [clienteId, setClienteId] = useState('');
  const [cliente, setCliente] = useState<Client | null>(null);
  const [fields, setFields] = useState(initialFields);
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
        tipo: 'contratoSolar',
        cliente_id: clienteId,
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

  if (generated) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>☀️ Contrato Solar — Preview</h1>
        <DocumentPreview
          content={generated.content}
          tipo="contratoSolar"
          clienteId={clienteId}
          clienteNome={generated.cliente_nome}
          dadosJson={fields}
          modeloUsado={generated.modelo_usado}
          onNewGeneration={() => setGenerated(null)}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>☀️ Contrato Solar</h1>
        <p className={styles.subtitle}>Contrato de instalação de sistema fotovoltaico</p>
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
            setCliente(c);
            if (c) {
              setFields(f => ({
                ...f,
                ...(c.cidade && !f.foro_cidade ? { foro_cidade: c.cidade } : {}),
                ...(c.endereco && !f.endereco_instalacao ? { endereco_instalacao: c.endereco } : {}),
              }));
            }
          }} />
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Especificações do Sistema</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Potência (kWp) *</label>
              <input type="text" value={fields.potencia_kwp} onChange={e => setFields({...fields, potencia_kwp: e.target.value})} placeholder="Ex: 7.2" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Qtd Módulos *</label>
              <input type="number" value={fields.quantidade_modulos} onChange={e => setFields({...fields, quantidade_modulos: e.target.value})} placeholder="Ex: 12" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Marca dos Módulos *</label>
              <input type="text" value={fields.marca_modulos} onChange={e => setFields({...fields, marca_modulos: e.target.value})} placeholder="Ex: 600W Tsun" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Qtd Inversores *</label>
              <input type="number" value={fields.quantidade_inversores} onChange={e => setFields({...fields, quantidade_inversores: e.target.value})} placeholder="Ex: 1" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Tipo de Inversor *</label>
              <input type="text" value={fields.tipo_inversor} onChange={e => setFields({...fields, tipo_inversor: e.target.value})} placeholder="Ex: Bifásico 220V" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Marca do Inversor *</label>
              <input type="text" value={fields.marca_inversor} onChange={e => setFields({...fields, marca_inversor: e.target.value})} placeholder="Ex: SAJ 6KW" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor Total (R$) *</label>
              <input type="text" value={fields.valor_total} onChange={e => setFields({...fields, valor_total: e.target.value})} placeholder="Ex: 15200,00" className="input-field" required />
            </div>
          </div>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Condições de Pagamento *</label>
            <textarea
              value={fields.condicoes_pagamento}
              onChange={e => setFields({...fields, condicoes_pagamento: e.target.value})}
              placeholder={"Ex: R$ 7.600,00 de entrada via PIX;\n18 parcelas de R$ 500,00 no cartão de crédito."}
              className={styles.textarea}
              rows={3}
              required
            />
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Prazos (dias)</h2>
          <div className={styles.grid3}>
            <div className={styles.field}>
              <label className={styles.label}>Projeto *</label>
              <input type="number" value={fields.prazo_projeto_dias} onChange={e => setFields({...fields, prazo_projeto_dias: e.target.value})} placeholder="10" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Aprovação concessionária *</label>
              <input type="number" value={fields.prazo_aprovacao_dias} onChange={e => setFields({...fields, prazo_aprovacao_dias: e.target.value})} placeholder="45" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Instalação (dias úteis) *</label>
              <input type="number" value={fields.prazo_instalacao_dias} onChange={e => setFields({...fields, prazo_instalacao_dias: e.target.value})} placeholder="30" className="input-field" required />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Garantias (anos)</h2>
          <div className={styles.grid3}>
            <div className={styles.field}>
              <label className={styles.label}>Módulos *</label>
              <input type="number" value={fields.garantia_modulos_anos} onChange={e => setFields({...fields, garantia_modulos_anos: e.target.value})} placeholder="15" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Inversor *</label>
              <input type="number" value={fields.garantia_inversor_anos} onChange={e => setFields({...fields, garantia_inversor_anos: e.target.value})} placeholder="10" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Instalação *</label>
              <input type="number" value={fields.garantia_instalacao_anos} onChange={e => setFields({...fields, garantia_instalacao_anos: e.target.value})} placeholder="2" className="input-field" required />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Localização</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Endereço de Instalação *</label>
              <input type="text" value={fields.endereco_instalacao} onChange={e => setFields({...fields, endereco_instalacao: e.target.value})} placeholder="Rua, nº, bairro, cidade - UF" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Foro (cidade) *</label>
              <input type="text" value={fields.foro_cidade} onChange={e => setFields({...fields, foro_cidade: e.target.value})} placeholder="Ex: Uberlândia" className="input-field" required />
            </div>
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}

        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteId}>
          {generating ? '⏳ Gerando documento...' : 
            mode === 'ai' ? '✨ Gerar com IA (PRO)' : `📄 Gerar ${mode === 'm2' ? 'Modelo 2' : 'Modelo 1'}`}
        </button>
      </form>
    </div>
  );
}

