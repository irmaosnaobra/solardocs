'use client';

import { useState } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

type Modo = 'em_branco' | 'digital';

function todayBR(): string {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const initialFields = {
  // sempre presentes
  data_visita: todayBR(),
  endereco_visita: '',
  tecnico_nome: '',
  modo: 'em_branco' as Modo,
  // modo digital — checks e valores. Ignorados se modo='em_branco'.
  consumo_kwh: '',
  padrao_tipo: '' as '' | 'mono' | 'bi' | 'tri',
  padrao_disjuntor: '',
  padrao_estado_ok: false,
  padrao_espaco_inversor: false,
  telhado_tipo: '' as '' | 'ceramica' | 'fibrocimento' | 'metalica' | 'laje',
  telhado_area: '',
  telhado_orientacao: '' as '' | 'N' | 'NE' | 'NO' | 'L' | 'O',
  telhado_sem_sombra: false,
  telhado_estrutura_ok: false,
  dim_potencia: '',
  dim_distancia: '',
  // fotos e documentos coletados
  foto_fachada: false,
  foto_padrao: false,
  foto_disjuntor: false,
  foto_relogio: false,
  foto_conta_luz: false,
  foto_cnh: false,
  conclusao: '' as '' | 'viavel' | 'ressalvas' | 'nao_viavel',
  observacoes: '',
};

export default function VistoriaPage() {
  const { user } = useDashboard();
  const [modoCliente, setModoCliente] = useState<'avulso' | 'cadastrado'>('avulso');
  const [clienteId, setClienteId] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  const isDigital = fields.modo === 'digital';
  const clienteOk = modoCliente === 'cadastrado' ? !!clienteId : !!clienteNome.trim();

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (modoCliente === 'cadastrado' && !clienteId) { setError('Selecione um cliente cadastrado'); return; }
    if (modoCliente === 'avulso' && !clienteNome.trim()) { setError('Informe o nome do cliente'); return; }

    setError('');
    setGenerating(true);
    try {
      const payload: Record<string, unknown> = {
        tipo: 'vistoria',
        fields,
        useTemplate: true,
        modeloNumero: 1,
      };
      if (modoCliente === 'cadastrado') payload.cliente_id = clienteId;
      else payload.cliente_nome_avulso = clienteNome.trim();
      const { data } = await api.post('/documents/generate', payload);
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
      <h1 className={styles.title}>Vistoria CheckList — Preview</h1>
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

  function setField<K extends keyof typeof fields>(k: K, v: (typeof fields)[K]) {
    setFields(f => ({ ...f, [k]: v }));
  }

  // Estilo compartilhado pros 2 botões de modo
  const modeBtn = (selected: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '14px 16px',
    borderRadius: 10,
    border: selected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
    background: selected ? 'rgba(245, 158, 11, 0.08)' : 'var(--color-surface)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: selected ? 700 : 500,
    textAlign: 'left' as const,
    transition: 'all 0.15s',
  });

  // Render de check item simples (label + checkbox)
  function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer', fontSize: 14, color: 'var(--color-text)' }}>
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
        {label}
      </label>
    );
  }

  // Render de seletor inline (radio-like)
  function PickRow<T extends string>({ label, options, value, onChange }: {
    label: string; options: { v: T; lbl: string }[]; value: T; onChange: (v: T) => void;
  }) {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map(o => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(value === o.v ? ('' as T) : o.v)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: value === o.v ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                background: value === o.v ? 'rgba(245, 158, 11, 0.1)' : 'var(--color-surface)',
                color: 'var(--color-text)',
                fontSize: 13,
                fontWeight: value === o.v ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {o.lbl}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Vistoria CheckList</h1>
        <p className={styles.subtitle}>Checklist de visita técnica solar</p>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        {/* MODO */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Como vai usar?</h2>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={() => setField('modo', 'em_branco')} style={modeBtn(fields.modo === 'em_branco')}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Em branco</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>PDF com boxes vazios pra imprimir e marcar à mão na obra</div>
            </button>
            <button type="button" onClick={() => setField('modo', 'digital')} style={modeBtn(fields.modo === 'digital')}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Preencher agora</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Marca aqui no celular durante a vistoria, gera o PDF preenchido</div>
            </button>
          </div>
        </div>

        {/* CLIENTE */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Cliente</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={() => setModoCliente('avulso')} style={{
              flex: 1, padding: '10px 14px', borderRadius: 8,
              border: modoCliente === 'avulso' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: modoCliente === 'avulso' ? 'rgba(245,158,11,0.08)' : 'var(--color-surface)',
              color: 'var(--color-text)', cursor: 'pointer', fontSize: 13,
              fontWeight: modoCliente === 'avulso' ? 700 : 500, textAlign: 'left',
            }}>
              Rápido (só nome)
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
              Cliente cadastrado
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 2 }}>
                Auto-preenche endereço da visita
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
              if (c && !fields.endereco_visita) {
                const partes = [c.endereco, c.cidade, c.uf].filter(Boolean).join(', ');
                if (partes) setField('endereco_visita', partes);
              }
            }} />
          )}
        </div>

        {/* DADOS BÁSICOS */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados da visita</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Data da visita *</label>
              <input type="text" value={fields.data_visita} onChange={e => setField('data_visita', e.target.value)} className="input-field" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Técnico responsável *</label>
              <input type="text" value={fields.tecnico_nome} onChange={e => setField('tecnico_nome', e.target.value)} placeholder="Nome + CREA (se houver)" className="input-field" required />
            </div>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Endereço da visita *</label>
              <input type="text" value={fields.endereco_visita} onChange={e => setField('endereco_visita', e.target.value)} placeholder="Rua, número, bairro, cidade/UF" className="input-field" required />
            </div>
          </div>
        </div>

        {/* CAMPOS DIGITAIS — só renderiza no modo "preencher agora" */}
        {isDigital && (
          <>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>1. Consumo</h2>
              <div className={styles.field}>
                <label className={styles.label}>Consumo médio (kWh/mês)</label>
                <input type="text" inputMode="numeric" value={fields.consumo_kwh} onChange={e => setField('consumo_kwh', e.target.value)} placeholder="Ex: 450" className="input-field" />
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>2. Padrão elétrico</h2>
              <PickRow
                label="Tipo"
                value={fields.padrao_tipo}
                options={[{ v: 'mono', lbl: 'Monofásico' }, { v: 'bi', lbl: 'Bifásico' }, { v: 'tri', lbl: 'Trifásico' }]}
                onChange={v => setField('padrao_tipo', v)}
              />
              <div className={styles.field} style={{ marginTop: 4 }}>
                <label className={styles.label}>Disjuntor (A)</label>
                <input type="text" inputMode="numeric" value={fields.padrao_disjuntor} onChange={e => setField('padrao_disjuntor', e.target.value)} placeholder="Ex: 50" className="input-field" />
              </div>
              <CheckRow label="Padrão em bom estado" value={fields.padrao_estado_ok} onChange={v => setField('padrao_estado_ok', v)} />
              <CheckRow label="Espaço para inversor próximo" value={fields.padrao_espaco_inversor} onChange={v => setField('padrao_espaco_inversor', v)} />
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>3. Telhado</h2>
              <PickRow
                label="Tipo"
                value={fields.telhado_tipo}
                options={[
                  { v: 'ceramica', lbl: 'Cerâmica' },
                  { v: 'fibrocimento', lbl: 'Fibrocimento' },
                  { v: 'metalica', lbl: 'Metálica' },
                  { v: 'laje', lbl: 'Laje' },
                ]}
                onChange={v => setField('telhado_tipo', v)}
              />
              <div className={styles.field} style={{ marginTop: 4 }}>
                <label className={styles.label}>Área útil (m²)</label>
                <input type="text" inputMode="numeric" value={fields.telhado_area} onChange={e => setField('telhado_area', e.target.value)} placeholder="Ex: 35" className="input-field" />
              </div>
              <PickRow
                label="Orientação"
                value={fields.telhado_orientacao}
                options={[
                  { v: 'N', lbl: 'Norte' },
                  { v: 'NE', lbl: 'NE' },
                  { v: 'NO', lbl: 'NO' },
                  { v: 'L', lbl: 'Leste' },
                  { v: 'O', lbl: 'Oeste' },
                ]}
                onChange={v => setField('telhado_orientacao', v)}
              />
              <CheckRow label="Sem sombreamento crítico" value={fields.telhado_sem_sombra} onChange={v => setField('telhado_sem_sombra', v)} />
              <CheckRow label="Estrutura ok pra suportar painéis" value={fields.telhado_estrutura_ok} onChange={v => setField('telhado_estrutura_ok', v)} />
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>4. Dimensionamento preliminar</h2>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Potência sugerida (kWp)</label>
                  <input type="text" inputMode="decimal" value={fields.dim_potencia} onChange={e => setField('dim_potencia', e.target.value)} placeholder="Ex: 5.5" className="input-field" />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Distância padrão → inversor (m)</label>
                  <input type="text" inputMode="numeric" value={fields.dim_distancia} onChange={e => setField('dim_distancia', e.target.value)} placeholder="Ex: 10" className="input-field" />
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>5. Fotos & documentos coletados</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                Marca o que você já tirou foto / coletou. Vai aparecer no PDF como evidência da vistoria.
              </p>
              <CheckRow label="Fachada do imóvel" value={fields.foto_fachada} onChange={v => setField('foto_fachada', v)} />
              <CheckRow label="Padrão de entrada" value={fields.foto_padrao} onChange={v => setField('foto_padrao', v)} />
              <CheckRow label="Disjuntor (close-up)" value={fields.foto_disjuntor} onChange={v => setField('foto_disjuntor', v)} />
              <CheckRow label="Relógio / medidor" value={fields.foto_relogio} onChange={v => setField('foto_relogio', v)} />
              <CheckRow label="Conta de luz" value={fields.foto_conta_luz} onChange={v => setField('foto_conta_luz', v)} />
              <CheckRow label="CNH do cliente" value={fields.foto_cnh} onChange={v => setField('foto_cnh', v)} />
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>6. Conclusão</h2>
              <PickRow
                label="Resultado"
                value={fields.conclusao}
                options={[
                  { v: 'viavel', lbl: 'Viável' },
                  { v: 'ressalvas', lbl: 'Com ressalvas' },
                  { v: 'nao_viavel', lbl: 'Não viável' },
                ]}
                onChange={v => setField('conclusao', v)}
              />
              <div className={styles.fieldFull} style={{ marginTop: 4 }}>
                <label className={styles.label}>Observações</label>
                <textarea value={fields.observacoes} onChange={e => setField('observacoes', e.target.value)} placeholder="Qualquer ressalva, recomendação, detalhe importante, próximos passos…" className={styles.textarea} rows={8} />
              </div>
            </div>
          </>
        )}

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteOk}>
          {generating ? 'Gerando...' : isDigital ? 'Gerar CheckList preenchido' : 'Gerar CheckList em branco'}
        </button>
      </form>
    </div>
  );
}
