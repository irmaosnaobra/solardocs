'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import api from '@/services/api';
import ContratoSolarForm from './forms/ContratoSolarForm';
import ProcuracaoForm from './forms/ProcuracaoForm';
import ReciboForm from './forms/ReciboForm';
import PropostaBancariaForm from './forms/PropostaBancariaForm';
import PrestacaoServicoForm from './forms/PrestacaoServicoForm';
import ContratoPjForm from './forms/ContratoPjForm';
import VistoriaForm from './forms/VistoriaForm';
import PropostaSolarForm from './forms/PropostaSolarForm';

interface CompanyGate {
  loaded: boolean;
  hasCompany: boolean;
  hasClient: boolean;
}

// Documentos que exigem empresa + cliente cadastrados antes de gerar.
// (Proposta Solar e Vistoria não entram — fluxo próprio.)
const REQUIRE_CLIENT = new Set([
  'contrato-solar',
  'procuracao',
  'recibo',
  'proposta-bancaria',
  'prestacao-servico',
  'contrato-pj',
]);

function CompanyRequiredGate({ tipo, children }: { tipo: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [gate, setGate] = useState<CompanyGate>({ loaded: false, hasCompany: false, hasClient: false });

  const needsClient = !!tipo && REQUIRE_CLIENT.has(tipo);

  useEffect(() => {
    if (!tipo) { setGate({ loaded: true, hasCompany: true, hasClient: true }); return; }
    const reqs: Promise<any>[] = [
      api.get('/company').then(({ data }) => !!data.company?.cnpj).catch(() => false),
      needsClient
        ? api.get('/clients').then(({ data }) => {
            const list = data?.clients ?? data ?? [];
            return Array.isArray(list) && list.length > 0;
          }).catch(() => false)
        : Promise.resolve(true),
    ];
    Promise.all(reqs).then(([hasCompany, hasClient]) =>
      setGate({ loaded: true, hasCompany, hasClient })
    );
  }, [tipo, needsClient]);

  const ok = gate.hasCompany && gate.hasClient;

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

  if (!ok) {
    const steps = [
      {
        done: gate.hasCompany,
        titulo: 'Cadastre sua empresa',
        desc: 'CNPJ e dados que aparecem em todo documento (com a sua marca).',
        cta: 'Cadastrar empresa',
        href: '/empresa',
      },
      ...(needsClient ? [{
        done: gate.hasClient,
        titulo: 'Cadastre um cliente',
        desc: 'Os dados do cliente preenchem o documento automaticamente.',
        cta: 'Cadastrar cliente',
        href: '/clientes',
      }] : []),
    ];
    // Próximo passo pendente = o primeiro não-concluído
    const proximo = steps.find((s) => !s.done);

    return (
      <div style={{
        maxWidth: 540,
        margin: '40px auto',
        padding: '34px 32px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
      }}>
        <h2 style={{ fontSize: 21, fontWeight: 800, marginBottom: 6, color: 'var(--color-text)', letterSpacing: '-0.02em', textAlign: 'center' }}>
          Falta pouco pra gerar este documento
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--color-text-muted)', marginBottom: 24, textAlign: 'center' }}>
          Complete os passos abaixo e o documento sai pronto, com seus dados e os do cliente.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 16px',
              background: s.done ? 'rgba(34,197,94,.08)' : 'var(--color-surface-2)',
              border: `1px solid ${s.done ? 'rgba(34,197,94,.4)' : 'var(--color-border)'}`,
              borderRadius: 12,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800,
                background: s.done ? '#22c55e' : 'var(--color-border)',
                color: s.done ? '#fff' : 'var(--color-text-muted)',
              }}>
                {s.done ? '✓' : i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--color-text)' }}>{s.titulo}</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 1 }}>{s.desc}</div>
              </div>
              {!s.done && (
                <button onClick={() => router.push(s.href)} className="btn-secondary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {s.cta} →
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {proximo && (
            <button onClick={() => router.push(proximo.href)} className="btn-primary" style={{ minWidth: 220 }}>
              {proximo.cta} →
            </button>
          )}
          <button onClick={() => router.push('/documentos?tipo=proposta')} className="btn-secondary">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function WelcomeBanner({ plan }: { plan: string | null }) {
  const router = useRouter();
  const [hasCompany, setHasCompany] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.get('/company')
      .then(({ data }) => setHasCompany(!!data.company?.cnpj))
      .catch(() => setHasCompany(false));
  }, []);

  if (dismissed || hasCompany === null || hasCompany === true) return null;

  const planLabel = plan === 'ilimitado' ? 'VIP' : plan === 'pro' ? 'PRO' : '';

  return (
    <div style={{
      maxWidth: 720,
      margin: '0 auto 28px',
      padding: '20px 24px',
      background: 'linear-gradient(135deg, rgba(34,197,94,0.10), rgba(245,158,11,0.10))',
      border: '1px solid rgba(34,197,94,0.35)',
      borderRadius: 14,
      position: 'relative',
    }}>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Fechar"
        style={{
          position: 'absolute', top: 10, right: 12,
          background: 'transparent', border: 0,
          color: 'var(--color-text-muted)', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: 4,
        }}
      >×</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: '#22c55e', color: '#0f172a',
          display: 'grid', placeItems: 'center',
          fontSize: 22, fontWeight: 900, flexShrink: 0,
        }}>✓</div>
        <div style={{ flex: '1 1 280px', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 800, fontSize: 15.5, color: 'var(--color-text)', marginBottom: 2 }}>
            Plano {planLabel} ativado! Seus 7 dias grátis começaram.
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>
            Dá uma olhada nos modelos abaixo. Quando quiser emitir, é só cadastrar sua empresa pra documentos saírem com sua marca.
          </div>
        </div>
        <button
          onClick={() => router.push('/empresa')}
          style={{
            background: '#f59e0b', color: '#0f172a',
            border: 0, padding: '10px 18px',
            borderRadius: 10, fontWeight: 800, fontSize: 13,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Cadastrar empresa →
        </button>
      </div>
    </div>
  );
}

function DocumentosContent() {
  const searchParams = useSearchParams();
  const tipo = searchParams.get('tipo');
  const isWelcome = searchParams.get('welcome') === '1';
  const planFromUrl = searchParams.get('plan');

  const formByType = (() => {
    switch (tipo) {
      case 'contrato-solar':     return <ContratoSolarForm />;
      case 'procuracao':         return <ProcuracaoForm />;
      case 'recibo':             return <ReciboForm />;
      case 'proposta-bancaria':  return <PropostaBancariaForm />;
      case 'prestacao-servico':  return <PrestacaoServicoForm />;
      case 'contrato-pj':        return <ContratoPjForm />;
      case 'vistoria':           return <VistoriaForm />;
      case 'proposta':           return <PropostaSolarForm />;
      default: return null;
    }
  })();

  if (!formByType) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        {isWelcome && <WelcomeBanner plan={planFromUrl} />}
        <h2 style={{ marginBottom: '2rem', fontSize: '1.4rem' }}>O que deseja gerar agora?</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '16px',
          maxWidth: '600px',
          margin: '0 auto',
        }}>
          {[
            { id: 'proposta',           icon: '⚡', label: 'Proposta Solar' },
            { id: 'vistoria',           icon: '📋', label: 'Vistoria CheckList' },
            { id: 'contrato-solar',     icon: '☀️', label: 'Contrato Solar' },
            { id: 'procuracao',         icon: '📜', label: 'Procuração' },
            { id: 'recibo',             icon: '🧾', label: 'Recibo' },
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
