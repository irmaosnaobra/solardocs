'use client';

import { useState, useEffect } from 'react';
import api from '@/services/api';
import styles from './historico.module.css';

interface Doc {
  id: string;
  tipo: string;
  cliente_nome: string;
  modelo_usado: string;
  created_at: string;
  signed_url: string | null;
}

const TIPO_LABEL: Record<string, string> = {
  contratoSolar: 'Contrato Solar',
  proposta: 'Proposta',
  procuracao: 'Procuração',
  prestacaoServico: 'Prestação de Serviço',
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

  if (loading) {
    return <div className={styles.page}><p className={styles.empty}>Carregando...</p></div>;
  }

  if (!historico) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Histórico de Documentos</h1>
        </div>
        <div className={styles.locked}>
          <div className={styles.lockedIcon}>🔒</div>
          <h2 className={styles.lockedTitle}>Disponível a partir do plano PRO</h2>
          <p className={styles.lockedDesc}>
            Acesse e baixe todos os documentos gerados nos últimos 30 dias.<br/>
            No VIP, o histórico é ilimitado.
          </p>
          <a href="/planos" className={styles.upgradeBtn}>Ver planos →</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Histórico de Documentos</h1>
        <p className={styles.subtitle}>
          {plano === 'pro' ? 'Últimos 30 dias' : 'Histórico completo'}
        </p>
      </div>

      {docs.length === 0 ? (
        <p className={styles.empty}>Nenhum documento salvo ainda. Gere e clique em "Salvar" após criar um documento.</p>
      ) : (
        <div className={styles.list}>
          {docs.map((doc) => (
            <div key={doc.id} className={styles.card}>
              <div className={styles.cardInfo}>
                <span className={styles.docTipo}>{TIPO_LABEL[doc.tipo] ?? doc.tipo}</span>
                <span className={styles.docCliente}>{doc.cliente_nome}</span>
                <span className={styles.docData}>
                  {new Date(doc.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <div className={styles.cardActions}>
                {doc.signed_url ? (
                  <a
                    href={doc.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.downloadBtn}
                  >
                    ⬇ Baixar
                  </a>
                ) : (
                  <span className={styles.noFile}>Sem arquivo</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
