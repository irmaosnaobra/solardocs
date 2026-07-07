'use client';

import { useState, useEffect } from 'react';
import ClientSelector from '@/components/ClientSelector/ClientSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

interface Pagamento { forma: string; data: string; valor: string }

const FORMAS = ['Pix', 'Espécie', 'Transferência', 'Cartão', 'Boleto', 'Cheque'];

// Converte "1.234,56" / "1234,56" / "1234.56" → número (igual ao parseBRL do backend)
function parseBRL(v: string): number {
  return parseFloat(String(v ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}
function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReciboPage() {
  const { user } = useDashboard();
  const [clienteId, setClienteId] = useState('');
  const [fields, setFields] = useState({
    numero: '',
    data_contrato: '',
    valor_contrato: '',
    descricao_servico: '',
    endereco_instalacao: '',
    foro_cidade: '',
    banco: '',
    agencia: '',
    conta: '',
    chave_pix: '',
  });
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([
    { forma: 'Pix', data: '', valor: '' },
  ]);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  function setField(key: keyof typeof fields, value: string) {
    setFields(f => ({ ...f, [key]: value }));
  }

  // Sugere número sequencial NNN/ANO e foro a partir da empresa
  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company?.cidade) setFields(f => ({ ...f, foro_cidade: f.foro_cidade || data.company.cidade }));
    }).catch(() => {});
    const ano = new Date().getFullYear();
    setFields(f => ({ ...f, numero: f.numero || `001/${ano}` }));
  }, []);

  function updatePagamento(idx: number, key: keyof Pagamento, value: string) {
    setPagamentos(ps => ps.map((p, i) => (i === idx ? { ...p, [key]: value } : p)));
  }
  function addPagamento() {
    setPagamentos(ps => [...ps, { forma: 'Espécie', data: '', valor: '' }]);
  }
  function removePagamento(idx: number) {
    setPagamentos(ps => ps.filter((_, i) => i !== idx));
  }

  // Totais ao vivo
  const totalPago = pagamentos.reduce((s, p) => s + parseBRL(p.valor), 0);
  const valorContrato = parseBRL(fields.valor_contrato);
  const saldo = Math.max(0, valorContrato - totalPago);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) { setError('Selecione um cliente'); return; }
    if (totalPago <= 0) { setError('Informe ao menos um pagamento com valor maior que zero'); return; }

    setError('');
    setGenerating(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'recibo',
        cliente_id: clienteId,
        fields: { ...fields, pagamentos },
        useTemplate: true,
        modeloNumero: 1,
      });
      setGenerated(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao gerar documento');
    } finally {
      setGenerating(false);
    }
  }

  if (generated) return (
    <div className={styles.page}>
      <h1 className={styles.title}>🧾 Recibo — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="recibo"
        clienteId={clienteId}
        clienteNome={generated.cliente_nome}
        dadosJson={{ ...fields, pagamentos }}
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
        <h1 className={styles.title}>🧾 Recibo de Pagamento</h1>
        <p className={styles.subtitle}>Comprovante de valores recebidos — calcula o saldo em aberto automaticamente</p>
      </div>

      <form onSubmit={handleGenerate} className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Pagador (Cliente)</h2>
          <ClientSelector value={clienteId} onChange={(id, c) => {
            setClienteId(id);
            if (c) {
              setFields(f => ({
                ...f,
                ...(c.endereco && !f.endereco_instalacao ? { endereco_instalacao: c.endereco } : {}),
                ...(c.cidade && !f.foro_cidade ? { foro_cidade: c.cidade } : {}),
              }));
            }
          }} />
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados do Recibo</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Número do recibo</label>
              <input type="text" value={fields.numero} onChange={e => setField('numero', e.target.value)}
                placeholder="Ex: 001/2026" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Data do contrato</label>
              <input type="text" value={fields.data_contrato} onChange={e => setField('data_contrato', e.target.value)}
                placeholder="Ex: 08/05/2026" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Valor total do contrato (R$)</label>
              <input type="text" value={fields.valor_contrato} onChange={e => setField('valor_contrato', e.target.value)}
                placeholder="Ex: 20.500,00 (vírgula = decimal)" className="input-field" />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Usado para calcular o saldo em aberto. Deixe vazio se for recibo de quitação total.
              </span>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade</label>
              <input type="text" value={fields.foro_cidade} onChange={e => setField('foro_cidade', e.target.value)}
                placeholder="Ex: São Paulo/SP" className="input-field" />
            </div>
          </div>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Referente a (descrição do serviço)</label>
            <input type="text" value={fields.descricao_servico} onChange={e => setField('descricao_servico', e.target.value)}
              placeholder="Ex: instalação de usina fotovoltaica de 9,6 kWp (16 módulos 600W + 4 inversores)" className="input-field" />
          </div>
          <div className={styles.fieldFull}>
            <label className={styles.label}>Endereço da instalação</label>
            <input type="text" value={fields.endereco_instalacao} onChange={e => setField('endereco_instalacao', e.target.value)}
              placeholder="Preenchido com o endereço do cliente — edite se necessário" className="input-field" />
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Pagamentos recebidos</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Adicione uma linha por pagamento. O total recebido e o saldo são calculados automaticamente.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pagamentos.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                <div className={styles.field}>
                  {i === 0 && <label className={styles.label}>Forma</label>}
                  <select value={p.forma} onChange={e => updatePagamento(i, 'forma', e.target.value)} className="input-field">
                    {FORMAS.map(fo => <option key={fo} value={fo}>{fo}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  {i === 0 && <label className={styles.label}>Data</label>}
                  <input type="text" value={p.data} onChange={e => updatePagamento(i, 'data', e.target.value)}
                    placeholder="Ex: 10/06/2026" className="input-field" />
                </div>
                <div className={styles.field}>
                  {i === 0 && <label className={styles.label}>Valor (R$)</label>}
                  <input type="text" value={p.valor} onChange={e => updatePagamento(i, 'valor', e.target.value)}
                    placeholder="Ex: 7.000,00" className="input-field" />
                </div>
                <button
                  type="button"
                  onClick={() => removePagamento(i)}
                  disabled={pagamentos.length === 1}
                  title={pagamentos.length === 1 ? 'Deixe ao menos uma linha' : 'Remover'}
                  style={{
                    height: 40, width: 40, borderRadius: 8, flexShrink: 0,
                    border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                    color: pagamentos.length === 1 ? 'var(--color-text-muted)' : 'var(--ink-red, #ef4444)',
                    cursor: pagamentos.length === 1 ? 'not-allowed' : 'pointer', fontSize: 18, lineHeight: 1,
                  }}
                >×</button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addPagamento}
            className="btn-secondary"
            style={{ marginTop: 12 }}
          >
            + Adicionar pagamento
          </button>

          {/* Resumo ao vivo */}
          <div style={{
            marginTop: 16, padding: '12px 16px', borderRadius: 10,
            background: 'var(--color-surface-2, rgba(148,163,184,0.08))',
            border: '1px solid var(--color-border)',
            display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 14,
          }}>
            <span>Total recebido: <strong>R$ {fmtBRL(totalPago)}</strong></span>
            {valorContrato > 0 && (
              <span style={{ color: saldo > 0 ? 'var(--ink-amber, #f59e0b)' : 'var(--ink-green, #16a34a)' }}>
                Saldo em aberto: <strong>R$ {fmtBRL(saldo)}</strong>
                {saldo <= 0 && ' (quitado)'}
              </span>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados bancários no rodapé <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>(opcional)</span></h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Se preenchidos, aparecem no rodapé do recibo. Deixe em branco para omitir.
          </p>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Banco</label>
              <input type="text" value={fields.banco} onChange={e => setField('banco', e.target.value)}
                placeholder="Ex: Banco 001" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Agência</label>
              <input type="text" value={fields.agencia} onChange={e => setField('agencia', e.target.value)}
                placeholder="Ex: 0001" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Conta corrente</label>
              <input type="text" value={fields.conta} onChange={e => setField('conta', e.target.value)}
                placeholder="Ex: 12345-6" className="input-field" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Chave Pix</label>
              <input type="text" value={fields.chave_pix} onChange={e => setField('chave_pix', e.target.value)}
                placeholder="Ex: CNPJ, e-mail ou telefone" className="input-field" />
            </div>
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className={`btn-primary ${styles.generateBtn}`} disabled={generating || !clienteId}>
          {generating ? '⏳ Gerando...' : '📄 Gerar Recibo'}
        </button>
      </form>
    </div>
  );
}
