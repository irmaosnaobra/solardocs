'use client';

import { useState, useEffect } from 'react';
import TerceiroSelector from '@/components/TerceiroSelector/TerceiroSelector';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';
import modeStyles from '../contrato-solar/mode.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

const initialFields = {
  qtd_modulos: '',
  modelo_modulo: '',
  qtd_inversores: '',
  modelo_inversor: '',
  valor_servico: '',
  forma_pagamento: '',
  prazo: '',
  foro_cidade: '',
  telefone_cliente: '',
  endereco_instalacao: '',
};

type Mode = 'm1' | 'm2' | 'ai';

const MODES: { id: Mode; icon: string; label: string; desc: string; badge?: string }[] = [
  { id: 'm1', icon: '📄', label: 'Modelo 1', desc: 'Direto · 10 cláusulas objetivas' },
  { id: 'm2', icon: '📋', label: 'Modelo 2', desc: 'Formal · Cláusulas detalhadas' },
  { id: 'ai', icon: '✨', label: 'Gerar com IA', desc: 'Escopo técnico personalizado por IA', badge: 'PRO' },
];

export default function PrestacaoServicoPage() {
  const { user, openUpgrade } = useDashboard();
  const [mode, setMode] = useState<Mode>('m1');
  const [terceiroId, setTerceiroId] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  function setField(key: keyof typeof initialFields, value: string) {
    setFields(f => ({ ...f, [key]: value }));
  }

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company?.cidade) setFields(f => ({ ...f, foro_cidade: f.foro_cidade || data.company.cidade }));
    }).catch(() => {});
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!terceiroId) { setError('Selecione o terceiro (CONTRATADA)'); return; }
    if (!clienteId) { setError('Selecione o cliente final'); return; }

    if (mode === 'ai' && user?.plano === 'free') {
      openUpgrade();
      return;
    }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'prestacaoServico',
        terceiro_id: terceiroId,
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

  if (generated) return (
    <div className={styles.page}>
      <h1 className={styles.title}>🔧 Prestação de Serviço — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="prestacaoServico"
        clienteId={clienteId}
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
        <h1 className={styles.title}>🔧 Prestação de Serviço</h1>
        <p className={styles.subtitle}>Contrato de montagem de sistema fotovoltaico</p>
      </div>

      <div className={modeStyles.modeSelector}>
        {MODES.map(m => (
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

        {/* CONTRATADA */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>CONTRATADA (Terceiro)</h2>
          <TerceiroSelector
            value={terceiroId}
            onChange={(id, t) => {
              setTerceiroId(id);
              if (t) setFields(f => ({
                ...f,
                ...(t.cidade && !f.foro_cidade ? { foro_cidade: t.cidade } : {}),
              }));
            }}
          />
        </div>

        {/* CLIENTE FINAL */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cliente Final</h2>
          <ClientSelector
            value={clienteId}
            onChange={(id, c) => {
              setClienteId(id);
              if (c) setFields(f => ({
                ...f,
                ...(c.endereco && !f.endereco_instalacao ? { endereco_instalacao: c.endereco } : {}),
                ...(c.cidade && !f.foro_cidade ? { foro_cidade: c.cidade } : {}),
              }));
            }}
          />
          <div className={styles.grid2} style={{ marginTop: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Telefone do cliente</label>
              <input
                type="text"
                value={fields.telefone_cliente}
                onChange={e => setField('telefone_cliente', e.target.value)}
                placeholder="Ex: (34) 99999-0000"
                className="input-field"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Endereço de instalação *</label>
              <input
                type="text"
                value={fields.endereco_instalacao}
                onChange={e => setField('endereco_instalacao', e.target.value)}
                placeholder="Endereço onde será instalado"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>

        {/* Sistema */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados do Sistema</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Qtd. de módulos *</label>
              <input
                type="text"
                value={fields.qtd_modulos}
                onChange={e => setField('qtd_modulos', e.target.value)}
                placeholder="Ex: 12"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Modelo dos módulos *</label>
              <input
                type="text"
                value={fields.modelo_modulo}
                onChange={e => setField('modelo_modulo', e.target.value)}
                placeholder="Ex: Jinko 550W Mono"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Qtd. de inversores *</label>
              <input
                type="text"
                value={fields.qtd_inversores}
                onChange={e => setField('qtd_inversores', e.target.value)}
                placeholder="Ex: 1"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Modelo do inversor *</label>
              <input
                type="text"
                value={fields.modelo_inversor}
                onChange={e => setField('modelo_inversor', e.target.value)}
                placeholder="Ex: Growatt 5kW"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>

        {/* Contrato */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados do Contrato</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Valor do serviço (R$) *</label>
              <input
                type="text"
                value={fields.valor_servico}
                onChange={e => setField('valor_servico', e.target.value)}
                placeholder="Ex: 3500,00 (vírgula = decimal)"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Prazo de execução (dias) *</label>
              <input
                type="text"
                value={fields.prazo}
                onChange={e => setField('prazo', e.target.value)}
                placeholder="Ex: 5"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade (foro) *</label>
              <input
                type="text"
                value={fields.foro_cidade}
                onChange={e => setField('foro_cidade', e.target.value)}
                placeholder="Ex: Uberlândia"
                className="input-field"
                required
              />
            </div>
          </div>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Forma de pagamento *</label>
            <textarea
              value={fields.forma_pagamento}
              onChange={e => setField('forma_pagamento', e.target.value)}
              placeholder="Ex: 50% na assinatura do contrato e 50% na conclusão dos serviços"
              className={styles.textarea}
              required
            />
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}
        <button
          type="submit"
          className={`btn-primary ${styles.generateBtn}`}
          disabled={generating || !terceiroId || !clienteId}
        >
          {generating ? '⏳ Gerando...' : 
            mode === 'ai' ? '✨ Gerar com IA (PRO)' : `📄 Gerar ${mode === 'm2' ? 'Modelo 2' : 'Modelo 1'}`}
        </button>
      </form>
    </div>
  );
}
