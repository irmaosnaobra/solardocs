'use client';

import { useState, useEffect, useRef } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

const PALETAS = [
  { id: 'solar',    nome: 'Solar',    c1: '#F59E0B', c2: '#FBBF24' },
  { id: 'oceano',   nome: 'Oceano',   c1: '#0EA5E9', c2: '#38BDF8' },
  { id: 'floresta', nome: 'Floresta', c1: '#10B981', c2: '#34D399' },
  { id: 'royal',    nome: 'Royal',    c1: '#8B5CF6', c2: '#A78BFA' },
  { id: 'carbono',  nome: 'Carbono',  c1: '#1F2937', c2: '#F59E0B' },
] as const;

const initialFields = {
  paleta: 'solar' as typeof PALETAS[number]['id'],
  vendedor_nome: '',
  cidade: '',
  uf: '',
  consumo_kwh: '',
  kwp: '',
  qtd_modulos: '',
  marca_modulo: '',
  potencia_modulo: '',
  qtd_inversores: '1',
  marca_inversor: '',
  potencia_inversor: '',
  investimento: '',
  parcelas: '60',
};

export default function PropostaSolarPage() {
  const { user } = useDashboard();
  const [clienteId, setClienteId] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [copyMsg, setCopyMsg] = useState('');

  // Auto-fill kWp baseado no consumo (estimativa: kWh/mês ÷ 130 = kWp)
  useEffect(() => {
    const kwh = parseFloat(fields.consumo_kwh);
    if (kwh && !fields.kwp) {
      const est = (kwh / 130).toFixed(2);
      setFields(f => ({ ...f, kwp: est }));
    }
  }, [fields.consumo_kwh, fields.kwp]);

  // Auto-fill qtd_modulos baseado em kwp + potencia_modulo
  useEffect(() => {
    const kwp = parseFloat(fields.kwp);
    const potMod = parseInt(fields.potencia_modulo, 10);
    if (kwp && potMod && !fields.qtd_modulos) {
      const qtd = Math.ceil((kwp * 1000) / potMod);
      setFields(f => ({ ...f, qtd_modulos: String(qtd) }));
    }
  }, [fields.kwp, fields.potencia_modulo, fields.qtd_modulos]);

  function setField<K extends keyof typeof fields>(k: K, v: (typeof fields)[K]) {
    setFields(f => ({ ...f, [k]: v }));
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) { setError('Selecione um cliente'); return; }
    if (!fields.kwp || !fields.investimento) { setError('Potência (kWp) e investimento são obrigatórios'); return; }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'propostaSolar',
        cliente_id: clienteId,
        fields,
        useTemplate: true,
        modeloNumero: 1,
      });
      setGenerated(data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Erro ao gerar proposta');
    } finally {
      setGenerating(false);
    }
  }

  async function handlePrint() {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.focus();
    iframeRef.current.contentWindow.print();
  }

  function handleCopyLink() {
    if (!generated?.doc_id) return;
    const url = `${window.location.origin}/p/${generated.doc_id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('Link copiado!');
      setTimeout(() => setCopyMsg(''), 2200);
    });
  }

  function handleWhatsApp() {
    if (!generated?.doc_id) return;
    const url = `${window.location.origin}/p/${generated.doc_id}`;
    const texto = encodeURIComponent(
      `Olá ${clienteNome || 'cliente'}! Aqui está sua proposta de energia solar:\n\n${url}\n\nQualquer dúvida me chama 👋`
    );
    window.open(`https://wa.me/?text=${texto}`, '_blank');
  }

  async function handlePdfDownload() {
    if (!generated?.doc_id) return;
    try {
      const res = await api.get(`/documents/${generated.doc_id}/pdf`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `proposta-${(clienteNome || 'cliente').toLowerCase().replace(/\s+/g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      alert('Erro ao baixar PDF.');
    }
  }

  // Quando preview ativo, fica fullscreen com iframe + ações
  if (generated) {
    return (
      <div className={styles.page}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <button type="button" onClick={() => setGenerated(null)} style={btn('ghost')}>← Nova proposta</button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={handleWhatsApp} style={btn('whatsapp')}>💬 WhatsApp</button>
          <button type="button" onClick={handleCopyLink} style={btn('primary')}>🔗 Copiar link</button>
          <button type="button" onClick={handlePrint} style={btn('outline')}>🖨️ Imprimir</button>
          <button type="button" onClick={handlePdfDownload} style={btn('outline')}>📄 PDF</button>
          {copyMsg && <span style={{ color: '#10B981', fontSize: 13, fontWeight: 600 }}>{copyMsg}</span>}
        </div>
        <div style={{
          background: '#F3F4F6',
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
          height: 'calc(100vh - 200px)',
          minHeight: 600,
        }}>
          <iframe
            ref={iframeRef}
            srcDoc={generated.content}
            title="Preview da Proposta"
            style={{ width: '100%', height: '100%', border: 0, background: 'white' }}
          />
        </div>
      </div>
    );
  }

  const PaletaPicker = (
    <div>
      <label className={styles.label}>Cor da proposta</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {PALETAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setField('paleta', p.id)}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: fields.paleta === p.id ? '2px solid var(--color-text)' : '1px solid var(--color-border)',
              background: `linear-gradient(135deg, ${p.c1}, ${p.c2})`,
              color: 'white',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              minWidth: 88,
              boxShadow: fields.paleta === p.id ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {p.nome}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>⚡ Proposta Solar</h1>
        <p className={styles.subtitle}>Gera proposta comercial bonita pra cliente final — copia link, manda WhatsApp ou imprime</p>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        {/* PALETA */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Visual</h2>
          {PaletaPicker}
        </div>

        {/* CLIENTE + VENDEDOR */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cliente e vendedor</h2>
          <ClientSelector value={clienteId} onChange={(id, c) => {
            setClienteId(id);
            setClienteNome(c?.nome || '');
            if (c) {
              if (c.cidade && !fields.cidade) setField('cidade', c.cidade);
              if (c.uf && !fields.uf) setField('uf', c.uf);
            }
          }} />
          <div className={styles.grid2} style={{ marginTop: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Vendedor responsável *</label>
              <input type="text" value={fields.vendedor_nome} onChange={e => setField('vendedor_nome', e.target.value)} placeholder="Nome completo" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade *</label>
              <input type="text" value={fields.cidade} onChange={e => setField('cidade', e.target.value)} placeholder="Ex: Uberlândia" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Estado (UF) *</label>
              <input type="text" maxLength={2} value={fields.uf} onChange={e => setField('uf', e.target.value.toUpperCase())} placeholder="MG" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Consumo médio (kWh/mês) *</label>
              <input type="text" inputMode="numeric" value={fields.consumo_kwh} onChange={e => setField('consumo_kwh', e.target.value)} placeholder="Ex: 450" className="input-field" required />
            </div>
          </div>
        </div>

        {/* SISTEMA */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Sistema fotovoltaico</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Potência total (kWp) *</label>
              <input type="text" inputMode="decimal" value={fields.kwp} onChange={e => setField('kwp', e.target.value)} placeholder="Ex: 5.5" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Quantidade de módulos *</label>
              <input type="text" inputMode="numeric" value={fields.qtd_modulos} onChange={e => setField('qtd_modulos', e.target.value)} placeholder="Ex: 12" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Marca dos módulos *</label>
              <input type="text" value={fields.marca_modulo} onChange={e => setField('marca_modulo', e.target.value)} placeholder="Ex: Canadian Solar" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Potência por módulo (W) *</label>
              <input type="text" inputMode="numeric" value={fields.potencia_modulo} onChange={e => setField('potencia_modulo', e.target.value)} placeholder="Ex: 550" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Quantidade de inversores</label>
              <input type="text" inputMode="numeric" value={fields.qtd_inversores} onChange={e => setField('qtd_inversores', e.target.value)} className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Marca do inversor *</label>
              <input type="text" value={fields.marca_inversor} onChange={e => setField('marca_inversor', e.target.value)} placeholder="Ex: Growatt" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Potência do inversor (kW) *</label>
              <input type="text" inputMode="decimal" value={fields.potencia_inversor} onChange={e => setField('potencia_inversor', e.target.value)} placeholder="Ex: 5" className="input-field" required />
            </div>
          </div>
        </div>

        {/* INVESTIMENTO */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Investimento</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Valor total (R$) *</label>
              <input type="text" inputMode="decimal" value={fields.investimento} onChange={e => setField('investimento', e.target.value)} placeholder="Ex: 28000" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Parcelas (financiamento)</label>
              <input type="text" inputMode="numeric" value={fields.parcelas} onChange={e => setField('parcelas', e.target.value)} placeholder="Ex: 60" className="input-field" />
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            A geração mensal e o payback (com inflação 6% a.a.) são calculados automaticamente baseado no kWp e UF.
          </p>
        </div>

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteId}>
          {generating ? '⏳ Gerando...' : '✨ Gerar Proposta'}
        </button>
      </form>
    </div>
  );
}

function btn(variant: 'primary' | 'outline' | 'ghost' | 'whatsapp'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.15s',
  };
  if (variant === 'primary') return { ...base, background: 'var(--color-primary, #F59E0B)', color: '#0F172A' };
  if (variant === 'whatsapp') return { ...base, background: '#25D366', color: 'white' };
  if (variant === 'outline') return { ...base, background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' };
  return { ...base, background: 'transparent', color: 'var(--color-text-muted)' };
}
