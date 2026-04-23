'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ContratoSolarForm from './forms/ContratoSolarForm';
import ProcuracaoForm from './forms/ProcuracaoForm';
import PropostaBancariaForm from './forms/PropostaBancariaForm';
import PrestacaoServicoForm from './forms/PrestacaoServicoForm';
import ContratoPjForm from './forms/ContratoPjForm';

function DocumentosContent() {
  const searchParams = useSearchParams();
  const tipo = searchParams.get('tipo');

  switch (tipo) {
    case 'contrato-solar':
      return <ContratoSolarForm />;
    case 'procuracao':
      return <ProcuracaoForm />;
    case 'proposta-bancaria':
      return <PropostaBancariaForm />;
    case 'prestacao-servico':
      return <PrestacaoServicoForm />;
    case 'contrato-pj':
      return <ContratoPjForm />;
    default:
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ marginBottom: '2rem', fontSize: '1.4rem' }}>O que deseja gerar agora?</h2>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
            gap: '16px',
            maxWidth: '600px',
            margin: '0 auto'
          }}>
            {[
              { id: 'contrato-solar', icon: '☀️', label: 'Contrato Solar' },
              { id: 'procuracao', icon: '📜', label: 'Procuração' },
              { id: 'proposta-bancaria', icon: '🏦', label: 'Proposta Bancária' },
              { id: 'prestacao-servico', icon: '🔧', label: 'Prestação de Serviço' },
              { id: 'contrato-pj', icon: '🤝', label: 'Contrato PJ' },
            ].map(d => (
              <a 
                key={d.id}
                href={`/documentos?tipo=${d.id}`}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '12px',
                  padding: '20px',
                  textDecoration: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'transform 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <span style={{ fontSize: '2rem' }}>{d.icon}</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)' }}>{d.label}</span>
              </a>
            ))}
          </div>
        </div>
      );
  }
}

export default function DocumentosPage() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <DocumentosContent />
    </Suspense>
  );
}
