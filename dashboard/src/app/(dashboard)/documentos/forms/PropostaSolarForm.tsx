'use client';

import { useState, useEffect, useRef } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null; codigo?: string | null }

// Comprime imagem pra max 1200px largura, JPEG 0.82.
// Foto de celular típica (3-5MB) cai pra ~120-180kb.
async function compressImage(file: File, maxW = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width > maxW ? maxW / img.width : 1;
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('img load'));
      img.src = String(e.target?.result || '');
    };
    reader.onerror = () => reject(new Error('reader'));
    reader.readAsDataURL(file);
  });
}

const PALETAS = [
  { id: 'solar',    nome: 'Solar',    c1: '#F59E0B', c2: '#FBBF24' },
  { id: 'oceano',   nome: 'Oceano',   c1: '#0EA5E9', c2: '#38BDF8' },
  { id: 'floresta', nome: 'Floresta', c1: '#10B981', c2: '#34D399' },
  { id: 'royal',    nome: 'Royal',    c1: '#8B5CF6', c2: '#A78BFA' },
  { id: 'carbono',  nome: 'Carbono',  c1: '#1F2937', c2: '#F59E0B' },
] as const;

const TIPOS_TELHADO = [
  { v: 'Cerâmico', lbl: '🏠 Cerâmico' },
  { v: 'Fibrocimento', lbl: '🏠 Fibrocimento' },
  { v: 'Metálico', lbl: '🏠 Metálico' },
  { v: 'Laje', lbl: '🏠 Laje' },
  { v: 'Solo', lbl: '🌾 Solo' },
  { v: 'Carport', lbl: '🚗 Carport' },
] as const;

const initialFields = {
  paleta: 'solar' as typeof PALETAS[number]['id'],
  vendedor_nome: '',
  vendedor_whatsapp: '',
  cidade: '',
  uf: '',
  consumo_kwh: '',
  qtd_modulos: '',
  marca_modulo: '',
  potencia_modulo: '',
  qtd_inversores: '1',
  marca_inversor: '',
  potencia_inversor: '',
  tipo_telhado: '' as '' | typeof TIPOS_TELHADO[number]['v'],
  investimento: '',
  preco_avista: '',
  foto_telhado_b64: '', // dataURL JPEG comprimido
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

  // kWp deriva de qtd_modulos × potencia_modulo (verdade técnica: 10×620W = 6,2 kWp)
  const kwpCalc = (() => {
    const qtd = parseInt(fields.qtd_modulos, 10);
    const pot = parseInt(fields.potencia_modulo, 10);
    if (qtd > 0 && pot > 0) return ((qtd * pot) / 1000);
    return 0;
  })();

  // Sugere qtd_modulos baseado no consumo (estimativa: kWh/mês ÷ 130 = kWp; depois divide pela W do módulo)
  useEffect(() => {
    const kwh = parseFloat(fields.consumo_kwh);
    const potMod = parseInt(fields.potencia_modulo, 10);
    if (kwh && potMod && !fields.qtd_modulos) {
      const kwpEst = kwh / 130;
      const qtd = Math.ceil((kwpEst * 1000) / potMod);
      setFields(f => ({ ...f, qtd_modulos: String(qtd) }));
    }
  }, [fields.consumo_kwh, fields.potencia_modulo, fields.qtd_modulos]);

  // Cálculo do 18× no cartão: investimento × 1,19 / 18, arredondado pra cima (sem centavos)
  const valor18x = (() => {
    const inv = parseFloat(String(fields.investimento).replace(',', '.'));
    if (!inv || inv <= 0) return 0;
    return Math.ceil((inv * 1.19) / 18);
  })();

  function setField<K extends keyof typeof fields>(k: K, v: (typeof fields)[K]) {
    setFields(f => ({ ...f, [k]: v }));
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) { setError('Selecione um cliente'); return; }
    if (!kwpCalc) { setError('Quantidade de módulos × potência por módulo precisam estar preenchidos'); return; }
    if (!fields.investimento) { setError('Valor do investimento é obrigatório'); return; }

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

  // Identificador público preferencial: codigo (YYYYUUUUNNNN), fallback pra UUID
  const publicId = generated?.codigo || generated?.doc_id;

  function handleCopyLink() {
    if (!publicId) return;
    const url = `${window.location.origin}/p/${publicId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('Link copiado!');
      setTimeout(() => setCopyMsg(''), 2200);
    });
  }

  function handleWhatsApp() {
    if (!publicId) return;
    const url = `${window.location.origin}/p/${publicId}`;
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
      // Nome do arquivo: usa código se houver, senão cliente slug
      a.download = generated.codigo
        ? `${generated.codigo}.pdf`
        : `proposta-${(clienteNome || 'cliente').toLowerCase().replace(/\s+/g, '-')}.pdf`;
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
          {generated.codigo && (
            <span style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.35)',
              color: 'var(--color-primary)',
              fontFamily: 'monospace',
              fontSize: 13,
              fontWeight: 700,
            }}>
              📄 {generated.codigo}
            </span>
          )}
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
              // Auto-fill tipo_telhado se cliente tem e mapeia pra um dos nossos
              const t = c.tipo_telhado;
              if (t && !fields.tipo_telhado) {
                const match = TIPOS_TELHADO.find(x => x.v.toLowerCase() === t.toLowerCase());
                if (match) setField('tipo_telhado', match.v);
              }
            }
          }} />
          <div className={styles.grid2} style={{ marginTop: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Vendedor responsável *</label>
              <input type="text" value={fields.vendedor_nome} onChange={e => setField('vendedor_nome', e.target.value)} placeholder="Nome completo" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>WhatsApp do vendedor *</label>
              <input type="tel" value={fields.vendedor_whatsapp} onChange={e => setField('vendedor_whatsapp', e.target.value)} placeholder="Ex: 34999999999 (com DDD)" className="input-field" required />
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
              <label className={styles.label}>Quantidade de módulos *</label>
              <input type="text" inputMode="numeric" value={fields.qtd_modulos} onChange={e => setField('qtd_modulos', e.target.value)} placeholder="Ex: 10" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Potência por módulo (W) *</label>
              <input type="text" inputMode="numeric" value={fields.potencia_modulo} onChange={e => setField('potencia_modulo', e.target.value)} placeholder="Ex: 620" className="input-field" required />
            </div>
            <div className={styles.fieldFull}>
              <div style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px dashed rgba(245,158,11,0.4)',
                borderRadius: 10,
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  ⚡ Potência calculada (qtd × W ÷ 1000)
                </span>
                <strong style={{ fontSize: 18, color: 'var(--color-primary)' }}>
                  {kwpCalc > 0 ? kwpCalc.toFixed(2).replace('.', ',') + ' kWp' : '—'}
                </strong>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Marca dos módulos *</label>
              <input type="text" value={fields.marca_modulo} onChange={e => setField('marca_modulo', e.target.value)} placeholder="Ex: Canadian Solar" className="input-field" required />
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
          <div style={{ marginTop: 16 }}>
            <label className={styles.label}>Tipo de instalação</label>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 8px' }}>
              Define a imagem padrão da proposta — telhado residencial, solo ou carport.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TIPOS_TELHADO.map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setField('tipo_telhado', fields.tipo_telhado === t.v ? '' : t.v)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: fields.tipo_telhado === t.v ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: fields.tipo_telhado === t.v ? 'rgba(245,158,11,0.1)' : 'var(--color-surface)',
                    color: 'var(--color-text)',
                    fontSize: 13,
                    fontWeight: fields.tipo_telhado === t.v ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {t.lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* FOTO DO TELHADO */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Foto do telhado (opcional)</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Sem foto, a proposta usa uma imagem padrão profissional de sistema solar. Se enviar a foto real do telhado, ganha autoridade — cliente vê que você esteve lá.
          </p>
          {fields.foto_telhado_b64 ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <img
                src={fields.foto_telhado_b64}
                alt="Foto do telhado"
                style={{ width: 180, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--color-border)' }}
              />
              <button
                type="button"
                onClick={() => setField('foto_telhado_b64', '')}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #EF4444', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: 13 }}
              >
                🗑️ Remover foto
              </button>
            </div>
          ) : (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '32px 20px',
              border: '2px dashed var(--color-border)',
              borderRadius: 12,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 14,
            }}>
              📷 Tirar foto / escolher do dispositivo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const b64 = await compressImage(file);
                    setField('foto_telhado_b64', b64);
                  } catch {
                    alert('Erro ao processar imagem. Tente outra.');
                  }
                }}
              />
            </label>
          )}
        </div>

        {/* INVESTIMENTO */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Investimento</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Preço do projeto (R$) *</label>
              <input type="text" inputMode="decimal" value={fields.investimento} onChange={e => setField('investimento', e.target.value)} placeholder="Ex: 22000" className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Desconto especial à vista (R$)</label>
              <input type="text" inputMode="decimal" value={fields.preco_avista} onChange={e => setField('preco_avista', e.target.value)} placeholder="Ex: 21300 (opcional)" className="input-field" />
            </div>
          </div>
          {valor18x > 0 && (
            <div style={{
              marginTop: 12,
              background: 'rgba(16,185,129,0.08)',
              border: '1px dashed rgba(16,185,129,0.4)',
              borderRadius: 10,
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                💳 Calculado automaticamente — 18× no cartão (×1,19)
              </span>
              <strong style={{ fontSize: 18, color: '#10B981' }}>
                18× R$ {valor18x.toLocaleString('pt-BR')}
              </strong>
            </div>
          )}
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            A geração mensal e o payback (inflação 6% a.a.) são calculados automaticamente baseado no kWp e UF.
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
