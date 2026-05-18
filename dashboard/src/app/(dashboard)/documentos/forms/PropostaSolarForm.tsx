'use client';

import { useState, useEffect, useRef } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null; codigo?: string | null; codigo_curto?: string | null; empresa_slug?: string | null }

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

const TIPOS_TELHADO = ['Cerâmico', 'Fibrocimento', 'Metálico', 'Cimento', 'Laje', 'Solo', 'Carport'] as const;

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
  tipo_telhado: '' as '' | typeof TIPOS_TELHADO[number],
  investimento: '',
  preco_avista: '',
  foto_telhado_b64: '', // dataURL JPEG comprimido
  // Campos editáveis (defaults aplicados no servidor se vierem vazios).
  // tarifa_kwh: deixar vazio = usa default do estado. Preencher = override por proposta.
  tarifa_kwh: '',
  taxa_minima: '90',
  prazo_instalacao_dias: '45',
  garantia_paineis: '25',
  garantia_inversor: '10',
  garantia_estrutura: '10',
  garantia_instalacao: '1',
  inflacao_aa: '6',
  taxa_minima_inflacao_aa: '6',
  // Formas de pagamento — consultor escolhe o que aparece para o cliente
  pag_vista: true,
  pag_cartao: true,
  pag_cartao_10: true,
  pag_cartao_12: true,
  pag_cartao_18: true,
  pag_fin: true,
  pag_fin_84: true,
  pag_fin_60: true,
  pag_entrada: true,
  pag_entrada_30: true,
  pag_entrada_60: true,
  pag_custom: '',
};

// PMT Price com carência: juros capitalizam durante a carência, depois Price padrão
function pmtPriceCarencia(pv: number, i: number, n: number, carenciaMeses: number) {
  if (!pv || pv <= 0) return 0;
  const saldo = pv * Math.pow(1 + i, carenciaMeses);
  return saldo * i / (1 - Math.pow(1 + i, -n));
}

export default function PropostaSolarPage() {
  const { user } = useDashboard();
  const [modoCliente, setModoCliente] = useState<'avulso' | 'cadastrado'>('avulso');
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

  // Sugere qtd_modulos baseado no consumo (estimativa: kWh/mês ÷ 115 = kWp).
  // Divisor 115 gera ~10% de oversize pra cobrir degradação dos painéis (~0,5% a.a.)
  // — sem isso, no ano 2-3 o sistema já fica deficitário.
  useEffect(() => {
    const kwh = parseFloat(fields.consumo_kwh);
    const potMod = parseInt(fields.potencia_modulo, 10);
    if (kwh && potMod && !fields.qtd_modulos) {
      const kwpEst = kwh / 115;
      const qtd = Math.ceil((kwpEst * 1000) / potMod);
      setFields(f => ({ ...f, qtd_modulos: String(qtd) }));
    }
  }, [fields.consumo_kwh, fields.potencia_modulo, fields.qtd_modulos]);

  // Parcelas no cartão (sobre o preço cheio): 10x ×1,11; 12x ×1,12; 18x ×1,19
  const invNum = (() => {
    const v = parseFloat(String(fields.investimento).replace(',', '.'));
    return v > 0 ? v : 0;
  })();
  const valor10x = invNum > 0 ? Math.ceil((invNum * 1.11) / 10) : 0;
  const valor12x = invNum > 0 ? Math.ceil((invNum * 1.12) / 12) : 0;
  const valor18x = invNum > 0 ? Math.ceil((invNum * 1.19) / 18) : 0;
  // Financiamento Price com 120 dias (4 meses) de carência sobre o preço cheio
  const valor84x = invNum > 0 ? Math.ceil(pmtPriceCarencia(invNum, 0.025, 84, 4)) : 0;
  const valor60x = invNum > 0 ? Math.ceil(pmtPriceCarencia(invNum, 0.024, 60, 4)) : 0;
  // Entrada + saldo: 50% hoje + 50% no vencimento (30 ou 60 dias)
  const valorEntradaMetade = invNum > 0 ? Math.ceil(invNum / 2) : 0;
  // DC/AC ratio: painéis em kWp sobre inversores em kW. Padrão de mercado 1,05-1,30.
  // Fora dessa faixa, mostra warning soft pro vendedor revisar o kit.
  const dcAcRatio = (() => {
    const potInv = parseFloat(String(fields.potencia_inversor).replace(',', '.'));
    const qtdInv = parseInt(fields.qtd_inversores, 10) || 1;
    const totalInvKw = potInv * qtdInv;
    if (!kwpCalc || !totalInvKw) return 0;
    return kwpCalc / totalInvKw;
  })();
  const dcAcWarning = (() => {
    if (!dcAcRatio) return '';
    if (dcAcRatio < 1.0) return `Inversor sobredimensionado (ratio ${dcAcRatio.toFixed(2).replace('.', ',')}). Padrão é 1,05-1,30 — cliente paga inversor que não usa.`;
    if (dcAcRatio > 1.35) return `Inversor subdimensionado (ratio ${dcAcRatio.toFixed(2).replace('.', ',')}). Vai perder geração nos picos — considere inversor maior.`;
    return '';
  })();

  function setField<K extends keyof typeof fields>(k: K, v: (typeof fields)[K]) {
    setFields(f => ({ ...f, [k]: v }));
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (modoCliente === 'cadastrado' && !clienteId) { setError('Selecione um cliente cadastrado'); return; }
    if (modoCliente === 'avulso' && !clienteNome.trim()) { setError('Informe o nome do cliente'); return; }
    if (!kwpCalc) { setError('Quantidade de módulos × potência por módulo precisam estar preenchidos'); return; }
    if (!fields.investimento) { setError('Valor do investimento é obrigatório'); return; }

    setError('');
    setGenerating(true);
    try {
      const payload: Record<string, unknown> = {
        tipo: 'propostaSolar',
        fields,
        useTemplate: true,
        modeloNumero: 1,
      };
      if (modoCliente === 'cadastrado') {
        payload.cliente_id = clienteId;
      } else {
        payload.cliente_nome_avulso = clienteNome.trim();
      }
      const { data } = await api.post('/documents/generate', payload);
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

  // Identificador público preferencial:
  //  1. slug.codigo_curto (irmaosnaobra.20260001) — novo padrão, mais bonito
  //  2. codigo de 12-dig (YYYYUUUUNNNN) — legacy
  //  3. UUID — fallback
  const publicId = (generated?.empresa_slug && generated?.codigo_curto)
    ? `${generated.empresa_slug}.${generated.codigo_curto}`
    : (generated?.codigo || generated?.doc_id);

  function handleCopyLink() {
    if (!publicId) return;
    const url = `${window.location.origin}/p/${publicId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('Link copiado!');
      setTimeout(() => setCopyMsg(''), 2200);
    });
  }

  // Quando preview ativo, fica fullscreen com iframe + ações
  if (generated) {
    return (
      <div className={styles.page}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <button type="button" onClick={() => setGenerated(null)} style={btn('ghost')}>← Nova proposta</button>
          {publicId && (
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
              📄 {publicId}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={handleCopyLink} style={btn('primary')}>🔗 Copiar link</button>
          <button type="button" onClick={handlePrint} style={btn('outline')}>🖨️ Imprimir</button>
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
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={() => setModoCliente('avulso')} style={{
              flex: 1, padding: '10px 14px', borderRadius: 8,
              border: modoCliente === 'avulso' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: modoCliente === 'avulso' ? 'rgba(245,158,11,0.08)' : 'var(--color-surface)',
              color: 'var(--color-text)', cursor: 'pointer', fontSize: 13,
              fontWeight: modoCliente === 'avulso' ? 700 : 500, textAlign: 'left',
            }}>
              ⚡ Rápido (só nome)
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 2 }}>
                Em cima do telhado, gerar agora
              </div>
            </button>
            <button type="button" onClick={() => setModoCliente('cadastrado')} style={{
              flex: 1, padding: '10px 14px', borderRadius: 8,
              border: modoCliente === 'cadastrado' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: modoCliente === 'cadastrado' ? 'rgba(245,158,11,0.08)' : 'var(--color-surface)',
              color: 'var(--color-text)', cursor: 'pointer', fontSize: 13,
              fontWeight: modoCliente === 'cadastrado' ? 700 : 500, textAlign: 'left',
            }}>
              📇 Cliente cadastrado
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 2 }}>
                Auto-preenche cidade, telhado, etc
              </div>
            </button>
          </div>

          {modoCliente === 'avulso' ? (
            <div className={styles.field}>
              <label className={styles.label}>Nome do cliente *</label>
              <input
                type="text"
                value={clienteNome}
                onChange={e => setClienteNome(e.target.value)}
                placeholder="Ex: João da Silva"
                className="input-field"
                required
              />
            </div>
          ) : (
            <ClientSelector value={clienteId} onChange={(id, c) => {
              setClienteId(id);
              setClienteNome(c?.nome || '');
              if (c) {
                if (c.cidade && !fields.cidade) setField('cidade', c.cidade);
                if (c.uf && !fields.uf) setField('uf', c.uf);
                const t = c.tipo_telhado;
                if (t && !fields.tipo_telhado) {
                  const match = TIPOS_TELHADO.find(x => x.toLowerCase() === t.toLowerCase());
                  if (match) setField('tipo_telhado', match);
                }
              }
            }} />
          )}
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
              <input type="text" inputMode="decimal" value={fields.potencia_inversor} onChange={e => setField('potencia_inversor', e.target.value)} placeholder="Ex: 1,875 ou 5" className="input-field" required />
            </div>
            {dcAcWarning && (
              <div className={styles.fieldFull}>
                <div style={{
                  background: 'rgba(245,158,11,0.10)',
                  border: '1px solid rgba(245,158,11,0.4)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 12,
                  color: '#92400E',
                  lineHeight: 1.5,
                }}>
                  ⚠️ {dcAcWarning}
                </div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <label className={styles.label}>Tipo de instalação</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {TIPOS_TELHADO.map((t) => {
                const selected = fields.tipo_telhado === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setField('tipo_telhado', selected ? '' : t)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: selected ? '2px solid var(--color-text)' : '1px solid var(--color-border)',
                      background: selected ? 'var(--color-text)' : 'var(--color-surface)',
                      color: selected ? 'var(--color-bg)' : 'var(--color-text)',
                      fontSize: 13,
                      fontWeight: selected ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* FOTO DO TELHADO */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Foto do telhado (opcional)</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Se enviar foto real do telhado, ganha autoridade — cliente vê que você esteve lá. Sem foto, a proposta sai limpa sem essa seção.
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
          <div style={{
            marginTop: 16,
            padding: '14px 16px',
            borderRadius: 12,
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.25)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
              Formas de pagamento que aparecem na proposta
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              {invNum > 0
                ? 'Marque o que o cliente vai ver. Desmarcar esconde da proposta gerada.'
                : 'Preencha o preço do projeto acima pra ver os valores das parcelas.'}
            </div>

            {/* À VISTA */}
            <PagGrupo
              checked={fields.pag_vista}
              onToggle={(v) => setField('pag_vista', v)}
              titulo="À vista"
              valor={invNum > 0
                ? `R$ ${(parseFloat(String(fields.preco_avista).replace(',','.')) > 0 && parseFloat(String(fields.preco_avista).replace(',','.')) < invNum ? parseFloat(String(fields.preco_avista).replace(',','.')) : invNum).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            />

            {/* CARTÃO DE CRÉDITO */}
            <PagGrupo
              checked={fields.pag_cartao}
              onToggle={(v) => setField('pag_cartao', v)}
              titulo="Cartão de crédito"
            >
              <PagSubItem
                checked={fields.pag_cartao_10}
                onToggle={(v) => setField('pag_cartao_10', v)}
                label="10x"
                valor={invNum > 0 ? `R$ ${valor10x.toLocaleString('pt-BR')}/mês` : '—'}
              />
              <PagSubItem
                checked={fields.pag_cartao_12}
                onToggle={(v) => setField('pag_cartao_12', v)}
                label="12x"
                valor={invNum > 0 ? `R$ ${valor12x.toLocaleString('pt-BR')}/mês` : '—'}
              />
              <PagSubItem
                checked={fields.pag_cartao_18}
                onToggle={(v) => setField('pag_cartao_18', v)}
                label="18x"
                valor={invNum > 0 ? `R$ ${valor18x.toLocaleString('pt-BR')}/mês` : '—'}
              />
            </PagGrupo>

            {/* FINANCIAMENTO */}
            <PagGrupo
              checked={fields.pag_fin}
              onToggle={(v) => setField('pag_fin', v)}
              titulo="Financiamento"
              subtitulo="120 dias de carência"
            >
              <PagSubItem
                checked={fields.pag_fin_84}
                onToggle={(v) => setField('pag_fin_84', v)}
                label="84x"
                sub="2,5% a.m."
                valor={invNum > 0 ? `R$ ${valor84x.toLocaleString('pt-BR')}/mês` : '—'}
              />
              <PagSubItem
                checked={fields.pag_fin_60}
                onToggle={(v) => setField('pag_fin_60', v)}
                label="60x"
                sub="2,4% a.m."
                valor={invNum > 0 ? `R$ ${valor60x.toLocaleString('pt-BR')}/mês` : '—'}
              />
            </PagGrupo>

            {/* ENTRADA + SALDO (30 ou 60 dias) */}
            <PagGrupo
              checked={fields.pag_entrada}
              onToggle={(v) => setField('pag_entrada', v)}
              titulo="Entrada + saldo"
              subtitulo="50% hoje + 50% no vencimento"
            >
              <PagSubItem
                checked={fields.pag_entrada_30}
                onToggle={(v) => setField('pag_entrada_30', v)}
                label="30 dias"
                sub="2 parcelas iguais"
                valor={invNum > 0 ? `R$ ${valorEntradaMetade.toLocaleString('pt-BR')} + R$ ${valorEntradaMetade.toLocaleString('pt-BR')}` : '—'}
              />
              <PagSubItem
                checked={fields.pag_entrada_60}
                onToggle={(v) => setField('pag_entrada_60', v)}
                label="60 dias"
                sub="2 parcelas iguais"
                valor={invNum > 0 ? `R$ ${valorEntradaMetade.toLocaleString('pt-BR')} + R$ ${valorEntradaMetade.toLocaleString('pt-BR')}` : '—'}
              />
            </PagGrupo>

            {/* PAGAMENTO CUSTOMIZADO — texto livre */}
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 8,
            }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--color-text)', marginBottom: 6 }}>
                Outro tipo de pagamento
              </label>
              <input
                type="text"
                value={fields.pag_custom}
                onChange={(e) => setField('pag_custom', e.target.value)}
                placeholder='Ex: "Boleto em 5x sem juros" ou "Permuta + saldo em 90 dias"'
                className="input-field"
                style={{ width: '100%' }}
              />
              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Se preenchido, vai aparecer como um card extra na proposta. Deixe vazio pra esconder.
              </span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            A geração mensal e o payback são calculados automaticamente baseado no kWp, UF e inflação configurada abaixo.
          </p>
        </div>

        {/* DETALHES EDITÁVEIS (abertos por padrão — afetam payback/economia) */}
        <details className={styles.section} style={{ cursor: 'pointer' }} open>
          <summary style={{
            listStyle: 'none',
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-text)',
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>⚙️ Tarifa, taxa mínima, garantias e prazo</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>
              ajuste por região se preciso
            </span>
          </summary>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '10px 0 14px' }}>
            Tarifa muda por região e concessionária. Os outros valores funcionam pra maioria dos casos.
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>⚡ Tarifa de energia (R$/kWh)</label>
              <input type="text" inputMode="decimal" value={fields.tarifa_kwh} onChange={e => setField('tarifa_kwh', e.target.value)} placeholder="vazio = default do estado" className="input-field" />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Ex: MG ≈ 1,20 · SP ≈ 0,92 · BA ≈ 0,99. Olha a conta de luz do cliente pra ser exato.
              </span>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Taxa mínima da concessionária (R$/mês)</label>
              <input type="text" inputMode="decimal" value={fields.taxa_minima} onChange={e => setField('taxa_minima', e.target.value)} placeholder="90" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Prazo de instalação (dias úteis)</label>
              <input type="text" inputMode="numeric" value={fields.prazo_instalacao_dias} onChange={e => setField('prazo_instalacao_dias', e.target.value)} placeholder="45" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia dos painéis (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_paineis} onChange={e => setField('garantia_paineis', e.target.value)} placeholder="25" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia do inversor (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_inversor} onChange={e => setField('garantia_inversor', e.target.value)} placeholder="10" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia da estrutura (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_estrutura} onChange={e => setField('garantia_estrutura', e.target.value)} placeholder="10" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Garantia da instalação (anos)</label>
              <input type="text" inputMode="numeric" value={fields.garantia_instalacao} onChange={e => setField('garantia_instalacao', e.target.value)} placeholder="1" className="input-field" />
            </div>
          </div>
        </details>

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || (modoCliente === 'cadastrado' ? !clienteId : !clienteNome.trim())}>
          {generating ? '⏳ Gerando...' : '✨ Gerar Proposta'}
        </button>
      </form>
    </div>
  );
}

function PagGrupo({
  checked, onToggle, titulo, subtitulo, valor, children,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  titulo: string;
  subtitulo?: string;
  valor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 8,
      opacity: checked ? 1 : 0.55,
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ width: 17, height: 17, accentColor: 'var(--color-primary)', cursor: 'pointer', margin: 0 }}
        />
        <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>
          {titulo}{subtitulo && <span style={{ fontWeight: 500, color: 'var(--color-text-muted)', fontSize: 11 }}> · {subtitulo}</span>}
        </span>
        {valor && <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>{valor}</span>}
      </label>
      {children && (
        <div style={{ marginTop: 8, paddingLeft: 27, display: 'grid', gap: 4, pointerEvents: checked ? 'auto' : 'none' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function PagSubItem({
  checked, onToggle, label, sub, valor,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  sub?: string;
  valor: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', padding: '4px 6px', borderRadius: 6 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--color-primary)', cursor: 'pointer', margin: 0 }}
      />
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>
        {label}{sub && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}> · {sub}</span>}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text)' }}>{valor}</span>
    </label>
  );
}

function btn(variant: 'primary' | 'outline' | 'ghost'): React.CSSProperties {
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
  if (variant === 'outline') return { ...base, background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' };
  return { ...base, background: 'transparent', color: 'var(--color-text-muted)' };
}
