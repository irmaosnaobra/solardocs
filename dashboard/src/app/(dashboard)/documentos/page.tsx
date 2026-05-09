'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import api from '@/services/api';
import ContratoSolarForm from './forms/ContratoSolarForm';
import ProcuracaoForm from './forms/ProcuracaoForm';
import PropostaBancariaForm from './forms/PropostaBancariaForm';
import PrestacaoServicoForm from './forms/PrestacaoServicoForm';
import ContratoPjForm from './forms/ContratoPjForm';
import VistoriaForm from './forms/VistoriaForm';

interface CompanyGate {
  loaded: boolean;
  ok: boolean;
}

function CompanyRequiredGate({ tipo, children }: { tipo: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [gate, setGate] = useState<CompanyGate>({ loaded: false, ok: false });

  useEffect(() => {
    if (!tipo) { setGate({ loaded: true, ok: true }); return; }
    api.get('/company')
      .then(({ data }) => setGate({ loaded: true, ok: !!data.company?.cnpj }))
      .catch(() => setGate({ loaded: true, ok: false }));
  }, [tipo]);

  if (!tipo) return <>{children}</>;
  if (!gate.loaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <div style={{
          width: 28, height: 28,
          border: '2.5px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'sd-spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes sd-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!gate.ok) {
    return (
      <div style={{
        maxWidth: 520,
        margin: '40px auto',
        padding: '36px 32px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        textAlign: 'center',
      }}>
        <div style={{
          width: 64, height: 64,
          margin: '0 auto 18px',
          borderRadius: '50%',
          background: 'rgba(245,158,11,.12)',
          border: '1px solid rgba(245,158,11,.35)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 28,
        }}>
          🏢
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10, color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
          Cadastra sua empresa primeiro
        </h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--color-text-muted)', marginBottom: 22 }}>
          Pra gerar contratos e procurações com a sua marca, precisamos do <strong style={{ color: 'var(--color-text)' }}>CNPJ da sua empresa</strong>.
          É rápido — em 1 minuto sai. Depois disso, todo documento sai pronto e bonito.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/empresa')}
            className="btn-primary"
            style={{ minWidth: 200 }}
          >
            Cadastrar minha empresa →
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="btn-secondary"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function DocumentosContent() {
  const searchParams = useSearchParams();
  const tipo = searchParams.get('tipo');

  const formByType = (() => {
    switch (tipo) {
      case 'contrato-solar':     return <ContratoSolarForm />;
      case 'procuracao':         return <ProcuracaoForm />;
      case 'proposta-bancaria':  return <PropostaBancariaForm />;
      case 'prestacao-servico':  return <PrestacaoServicoForm />;
      case 'contrato-pj':        return <ContratoPjForm />;
      case 'vistoria':           return <VistoriaForm />;
      default: return null;
    }
  })();

  if (!formByType) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '2rem', fontSize: '1.4rem' }}>O que deseja gerar agora?</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '16px',
          maxWidth: '600px',
          margin: '0 auto',
        }}>
          {[
            { id: 'vistoria',           icon: '📋', label: 'Vistoria CheckList' },
            { id: 'contrato-solar',     icon: '☀️', label: 'Contrato Solar' },
            { id: 'procuracao',         icon: '📜', label: 'Procuração' },
            { id: 'proposta-bancaria',  icon: '🏦', label: 'Proposta Bancária' },
            { id: 'prestacao-servico',  icon: '🔧', label: 'Prestação de Serviço' },
            { id: 'contrato-pj',        icon: '🤝', label: 'Contrato Vendedor' },
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
                transition: 'transform 0.2s',
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

  return (
    <CompanyRequiredGate tipo={tipo}>
      {formByType}
    </CompanyRequiredGate>
  );
}

export default function DocumentosPage() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <DocumentosContent />
    </Suspense>
  );
}
