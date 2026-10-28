'use client';

import { useState, useEffect } from 'react';
import TerceiroSelector from '@/components/TerceiroSelector/TerceiroSelector';
import DocumentPreview from '@/components/DocumentPreview/DocumentPreview';
import InfoHint from '@/components/InfoHint/InfoHint';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../documentos.module.css';
import { useEdicaoDocumento, mesclarCampos, erroDaApi } from './useEdicaoDocumento';
import { BannerEdicao, ClienteTravado, EstadoCarga, RESPIRO_EDICAO } from './BannerEdicao';

interface GeneratedDoc { content: string; modelo_usado: string; cliente_nome: string; doc_id: string | null }

const initialFields = {
  percentual_comissao: '3',
  adiantamento_quinzenal: '900,00',
  meta_semanal: '2',
  foro_cidade: '',
};

export default function ContratoPJPage() {
  const { user } = useDashboard();
  const [terceiroId, setTerceiroId] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState('');

  // Modo edição (?doc=<id>): o mesmo formulário reabre o documento salvo e, ao gerar,
  // atualiza o MESMO registro (mesmo link e mesmo número) sem gastar cota.
  const ed = useEdicaoDocumento({
    tipoApi: 'contratoPJ',
    slug: 'contrato-pj',
    aoCarregar: (d) => {
      setTerceiroId(d.terceiro_id ?? '');
      setFields(f => mesclarCampos(f, d.dados_json));
    },
  });

  useEffect(() => {
    api.get('/company').then(({ data }) => {
      if (data.company?.cidade) setFields(f => ({ ...f, foro_cidade: f.foro_cidade || data.company.cidade }));
    }).catch(() => {});
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!terceiroId) { setError('Selecione o vendedor (terceiro)'); return; }

    setError('');
    setGenerating(true);
    try {
      const data = await ed.enviar({
        tipo: 'contratoPJ',
        terceiro_id: terceiroId,
        fields,
        useTemplate: true,
        modeloNumero: 1,
      });
      setGenerated(data);
    } catch (err: unknown) {
      setError(erroDaApi(err, 'Erro ao gerar documento'));
    } finally {
      setGenerating(false);
    }
  }

  // Abrindo um documento para editar: espera carregar, ou mostra por que não abriu.
  if (ed.docParam && !ed.edicao) {
    return <div className={styles.page}><EstadoCarga carregando={ed.carregando} erro={ed.erroCarga} onVoltar={ed.cancelar} /></div>;
  }

  if (generated) return (
    <div className={styles.page}>
      <h1 className={styles.title}>Contrato Vendedor — Preview</h1>
      <DocumentPreview
        content={generated.content}
        tipo="contratoPJ"
        clienteId=""
        terceiroId={terceiroId}
        clienteNome={generated.cliente_nome}
        dadosJson={fields}
        modeloUsado={generated.modelo_usado}
        docId={generated.doc_id}
        userPlano={user?.plano}
        onNewGeneration={() => (ed.editando ? ed.novoDocumento() : setGenerated(null))}
      />
    </div>
  );

  return (
    <div className={`${styles.page} ${ed.editando ? RESPIRO_EDICAO : ''}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>Contrato Vendedor</h1>
        <p className={styles.subtitle}>Representação comercial autônoma (PF ou PJ) — comissão por resultado + adiantamento quinzenal</p>
      </div>

      {ed.editando && (
        <BannerEdicao rotulo="contrato de vendedor" cliente={ed.edicao?.cliente_nome ?? null} onCancelar={ed.cancelar} />
      )}

      <form onSubmit={handleGenerate} className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Vendedor / Representante (Terceiro)</h2>
          {ed.travaCliente ? <ClienteTravado nome={ed.edicao?.cliente_nome ?? null} /> : <TerceiroSelector value={terceiroId} onChange={(id, t) => {
            setTerceiroId(id);
            if (t) setFields(f => ({
              ...f,
              ...(t.cidade && !f.foro_cidade ? { foro_cidade: t.cidade } : {}),
            }));
          }} />}
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Condições Comerciais</h2>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Comissão (%) *</label>
              <input
                type="number"
                step="0.01"
                value={fields.percentual_comissao}
                onChange={e => setFields({ ...fields, percentual_comissao: e.target.value })}
                placeholder="3"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Adiantamento quinzenal (R$) *<InfoHint>Pago nos dias 5 e 20 de cada mês; suspende automático se ficar 30 dias sem venda.</InfoHint></label>
              <input
                type="text"
                value={fields.adiantamento_quinzenal}
                onChange={e => setFields({ ...fields, adiantamento_quinzenal: e.target.value })}
                placeholder="900,00"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Meta semanal (vendas) *</label>
              <input
                type="number"
                min="1"
                value={fields.meta_semanal}
                onChange={e => setFields({ ...fields, meta_semanal: e.target.value })}
                placeholder="2"
                className="input-field"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Foro (cidade) *</label>
              <input
                type="text"
                value={fields.foro_cidade}
                onChange={e => setFields({ ...fields, foro_cidade: e.target.value })}
                placeholder="Ex: São Paulo"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}
        <button
          type="submit"
          className={`btn-primary ${styles.generateBtn}`}
          disabled={generating || !terceiroId}
        >
          {generating ? (ed.editando ? 'Salvando...' : 'Gerando...') : (ed.editando ? 'Salvar alterações' : 'Gerar Contrato Vendedor')}
        </button>
      </form>
    </div>
  );
}
