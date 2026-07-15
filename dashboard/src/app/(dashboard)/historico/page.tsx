'use client';

import { useState, useEffect } from 'react';
import { Download, Lock } from 'lucide-react';
import api from '@/services/api';
import { downloadDocumentPdf } from '@/services/downloadPdf';
import styles from './historico.module.css';
import { fmtDateBR } from '@/utils/brasilia';

interface Doc {
  id: string;
  tipo: string;
  cliente_nome: string;
  modelo_usado: string;
  created_at: string;
  signed_url: string | null;
}

const TIPO_LABEL: Record<string, string> = {
  contratoSolar:    'Contrato Solar',
  proposta:         'Proposta',
  procuracao:       'Procuração',
  recibo:           'Recibo',
  prestacaoServico: 'Prestação de Serviço',
  contratoPJ:       'Contrato Vendedor',
  propostaBanco:    'Proposta Bancária',
  vistoria:         'Vistoria CheckList',
  propostaSolar:    'Proposta Solar',
};

export default function HistoricoPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [historico, setHistorico] = useState(false);
  const [plano, setPlano] = useState('');

  useEffect(() => {
    api.get('/documents/list').then(({ data }) => {
      setDocs(data.documents ?? []);
      setHistorico(data.historico);
      setPlano(data.plano);
    }).finally(() => setLoading(false));
  }, []);

  function handleDownloadPdf(doc: Doc) {
    // Download via iframe oculto (não prende o PWA no iOS). Ver downloadPdf.ts.
    if (downloadDocumentPdf(doc.id) === 'no-token') {
      alert('Sessão expirou. Faça login novamente.');
    }
  }

  if (loading) return <div className={styles.page}><p className={styles.empty}>Carregando...</p></div>;

  if (!historico) {
    return (
      <div className={styles.page}>
        <div className={styles.header}><h1 className={styles.title}>Meus Documentos</h1></div>
        <div className={styles.locked}>
          <div className={styles.lockedIcon}><Lock size={40} /></div>
          <h2 className={styles.lockedTitle}>Disponível a partir do plano PRO</h2>
          <p className={styles.lockedDesc}>
            Acesse e baixe todos os documentos gerados nos últimos 30 dias.<br/>
            No VIP, o histórico é ilimitado.
          </p>
          <a href="/#planos" className={styles.upgradeBtn}>Ver planos →</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Meus Documentos</h1>
        <p className={styles.subtitle}>
          {plano === 'pro' ? 'Últimos 30 dias' : plano === 'free' ? 'Período de teste' : 'Histórico completo'}
        </p>
      </div>

      {docs.length === 0 ? (
        <p className={styles.empty}>Nenhum documento gerado ainda. Os documentos são salvos automaticamente após a geração.</p>
      ) : (
        <div className={styles.list}>
          {docs.map((doc) => (
            <div key={doc.id} className={styles.card}>
              <div className={styles.cardInfo}>
                <span className={styles.docTipo}>{TIPO_LABEL[doc.tipo] ?? doc.tipo}</span>
                <span className={styles.docCliente}>{doc.cliente_nome}</span>
                <span className={styles.docData}>{fmtDateBR(doc.created_at)}</span>
              </div>
              <div className={styles.cardActions}>
                {doc.signed_url ? (
                  <button
                    className={styles.downloadBtn}
                    onClick={() => handleDownloadPdf(doc)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Download size={15} /> Baixar PDF
                  </button>
                ) : (
                  <span className={styles.noFile}>Processando...</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
