'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar/Sidebar';
import TopBar from '@/components/TopBar/TopBar';
import UpgradeModal from '@/components/UpgradeModal/UpgradeModal';
import { DashboardProvider, useDashboard } from '@/contexts/DashboardContext';
import { isAuthenticated, removeToken } from '@/services/auth';
import api from '@/services/api';
import styles from './dashboard.module.css';

const PLANOS_DATA = [
  {
    key: 'pro',
    name: 'PRO',
    amount: '27',
    indicado: 'Indicado para até 20 vendas/mês',
    features: [
      '90 documentos por mês',
      'Contrato Solar, Prestação de Serviço, Procuração, Contrato Vendedor e Proposta Bancária',
      'Geração com IA + 2 modelos prontos',
      'Contratos com a logomarca da sua empresa',
      'Histórico dos últimos 30 dias',
    ],
    featured: false,
  },
  {
    key: 'ilimitado',
    name: 'VIP',
    amount: '67',
    indicado: 'Indicado para +20 vendas/mês',
    features: [
      'Documentos ilimitados — sem teto mensal',
      'Todos os 5 tipos de documento',
      'Geração com IA + 2 modelos prontos',
      'Contratos com a logomarca da sua empresa',
      'Histórico completo e permanente',
      'Dashboard com gráficos e analytics de uso',
      'Clientes e terceiros ilimitados',
      'Acesso antecipado a todo novo recurso',
      'Participa das decisões da plataforma',
      'Suporte prioritário direto no WhatsApp',
    ],
    featured: true,
  },
];

function BillingSuspendedPage({ email }: { email: string }) {
  const [loading, setLoading] = useState(false);

  async function abrirPortal() {
    setLoading(true);
    try {
      const { data } = await api.post('/payments/billing-portal');
      window.location.href = data.url;
    } catch {
      alert('Falha ao abrir portal de pagamento. Tente novamente em instantes ou entre em contato pelo WhatsApp (34) 99943-7831.');
      setLoading(false);
    }
  }

  function sair() {
    removeToken();
    window.location.href = '/auth?mode=login';
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg, #0b1120)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{
        maxWidth: 520,
        width: '100%',
        background: 'linear-gradient(145deg, #1a1200 0%, #2d1f00 50%, #1a1200 100%)',
        border: '1.5px solid rgba(251,191,36,0.4)',
        borderRadius: 22,
        padding: '40px 36px',
        textAlign: 'center',
        boxShadow: '0 4px 28px rgba(251,191,36,0.15)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 12px', lineHeight: 1.3 }}>
          Sua conta está temporariamente suspensa
        </h1>
        <p style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 8px' }}>
          A cobrança da sua assinatura não foi processada e os 7 dias de tolerância encerraram.
        </p>
        <p style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 28px' }}>
          A reativação é <strong style={{ color: '#fbbf24' }}>imediata</strong> assim que você atualizar a forma de pagamento. Todo o seu histórico está preservado.
        </p>

        <button
          onClick={abrirPortal}
          disabled={loading}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: 12,
            background: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
            color: '#0f172a',
            fontWeight: 900,
            fontSize: '1rem',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            boxShadow: '0 4px 18px rgba(245,158,11,0.45)',
            marginBottom: 12,
          }}
        >
          {loading ? 'Aguarde...' : 'Atualizar forma de pagamento'}
        </button>

        <button
          onClick={sair}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 12,
            background: 'transparent',
            color: '#94a3b8',
            fontWeight: 600,
            fontSize: '0.9rem',
            border: '1px solid #334155',
            cursor: 'pointer',
          }}
        >
          Sair da conta
        </button>

        <p style={{ color: '#64748b', fontSize: '0.78rem', margin: '24px 0 0' }}>
          {email}
        </p>
        <p style={{ color: '#475569', fontSize: '0.75rem', margin: '12px 0 0', lineHeight: 1.6 }}>
          Precisa de ajuda? WhatsApp <strong style={{ color: '#94a3b8' }}>(34) 99943-7831</strong>
        </p>
      </div>
    </div>
  );
}

function UpgradePage({ email }: { email: string }) {
  const [loading, setLoading] = useState<string | null>(null);

  async function assinar(planKey: string) {
    setLoading(planKey);
    try {
      const { data } = await api.post('/payments/create-checkout', { plan: planKey });
      if (data.upgraded) {
        alert('Plano atualizado! A diferença foi cobrada no seu cartão. Recarregando...');
        window.location.reload();
        return;
      }
      window.location.href = data.url;
    } catch {
      alert('Erro ao iniciar pagamento. Tente novamente.');
      setLoading(null);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg, #0b1120)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>⚡</div>
        <h1 style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--color-text)', margin: '0 0 8px' }}>
          Seus 10 documentos gratuitos acabaram
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '1rem', margin: 0 }}>
          Escolha um plano e continue gerando documentos profissionais agora
        </p>
        <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 6 }}>{email}</p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 24,
        width: '100%',
        maxWidth: 860,
      }}>
        {PLANOS_DATA.map((p) => (
          <div key={p.key} style={{
            background: p.featured
              ? 'linear-gradient(145deg, #1a1200 0%, #2d1f00 45%, #1a1200 100%)'
              : 'linear-gradient(145deg, #0f172a 0%, #0d1f3c 50%, #0a1628 100%)',
            border: p.featured
              ? '1.5px solid rgba(251,191,36,0.45)'
              : '1px solid rgba(99,179,237,0.25)',
            borderRadius: 22,
            padding: '32px 28px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            position: 'relative',
            boxShadow: p.featured
              ? '0 4px 28px rgba(251,191,36,0.15)'
              : '0 4px 20px rgba(99,179,237,0.07)',
          }}>
            {p.featured && (
              <div style={{
                position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                background: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                color: '#0f172a', fontSize: '0.72rem', fontWeight: 800,
                padding: '4px 18px', borderRadius: 99, textTransform: 'uppercase',
                letterSpacing: '1.2px', whiteSpace: 'nowrap',
              }}>Mais Popular</div>
            )}

            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: p.featured ? '#fbbf24' : '#63b3ed' }}>
              {p.name}
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: '1.3rem', fontWeight: 600, color: '#e2e8f0' }}>R$</span>
              <span style={{ fontSize: '3.4rem', fontWeight: 900, letterSpacing: -2, color: '#fff', lineHeight: 1 }}>{p.amount}</span>
              <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>/mês</span>
            </div>

            <div style={{
              fontSize: '0.83rem', fontWeight: 700, textAlign: 'center', padding: '8px 12px',
              borderRadius: 8, marginBottom: 4,
              color: p.featured ? '#fbbf24' : '#63b3ed',
              background: p.featured ? 'rgba(251,191,36,0.1)' : 'rgba(99,179,237,0.1)',
              border: `1px solid ${p.featured ? 'rgba(251,191,36,0.3)' : 'rgba(99,179,237,0.25)'}`,
            }}>{p.indicado}</div>

            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              {p.features.map((f) => (
                <li key={f} style={{ fontSize: '0.88rem', color: '#cbd5e1', paddingLeft: 18, position: 'relative', lineHeight: 1.4 }}>
                  <span style={{ position: 'absolute', left: 0, color: '#22c55e', fontWeight: 700 }}>✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => assinar(p.key)}
              disabled={loading === p.key}
              style={{
                marginTop: 8,
                padding: '14px',
                borderRadius: 12,
                fontWeight: p.featured ? 900 : 800,
                fontSize: '0.97rem',
                cursor: loading === p.key ? 'not-allowed' : 'pointer',
                opacity: loading === p.key ? 0.6 : 1,
                width: '100%',
                letterSpacing: '0.3px',
                transition: 'all 0.2s',
                ...(p.featured ? {
                  background: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
                  color: '#0f172a',
                  border: 'none',
                  boxShadow: '0 4px 18px rgba(245,158,11,0.45)',
                } : {
                  background: 'transparent',
                  color: '#63b3ed',
                  border: '2px solid #63b3ed',
                }),
              }}
            >
              {loading === p.key ? 'Aguarde...' : `Assinar ${p.name} →`}
            </button>
          </div>
        ))}
      </div>

      <p style={{ color: '#475569', fontSize: '0.78rem', marginTop: 28 }}>
        Já assinou?{' '}
        <a href="/auth?mode=login" style={{ color: '#63b3ed', textDecoration: 'underline' }}>
          Entre novamente com o e-mail da compra
        </a>
      </p>
    </div>
  );
}

// Paths que free pode acessar sem upgrade. Resto vira locked/redirect.
// /documentos é tratado à parte (só libera quando tipo=proposta).
const FREE_ALLOWED_PATHS = ['/empresa', '/planos'];

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, setUser, showUpgrade, setShowUpgrade } = useDashboard();
  const [hasCompany, setHasCompany] = useState(false);
  const [companyLoaded, setCompanyLoaded] = useState(false);

  const fetchCompany = useCallback(() => {
    api.get('/company').then(({ data }) => {
      setHasCompany(!!data.company?.cnpj);
    }).catch(() => {}).finally(() => setCompanyLoaded(true));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/auth?mode=login');
      return;
    }
    api.get('/auth/me').then(({ data }) => {
      setUser(data.user);
      if (data.user?.is_admin) {
        setHasCompany(true);
        setCompanyLoaded(true);
        return;
      }
      fetchCompany();
    }).catch(() => router.push('/auth?mode=login'));

    const handler = () => fetchCompany();
    window.addEventListener('company-saved', handler);
    return () => window.removeEventListener('company-saved', handler);
  }, [router, fetchCompany, setUser]);

  useEffect(() => {
    const handler = () => setShowUpgrade(true);
    window.addEventListener('limit-reached', handler);
    return () => window.removeEventListener('limit-reached', handler);
  }, [setShowUpgrade]);

  if (!user || !companyLoaded) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-bg)',
      }}>
        <div style={{
          width: 32,
          height: 32,
          border: '2.5px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'sd-spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes sd-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Free user: empresa é obrigatória pra ativar o gerador; navegação fica restrita
  // a /empresa, /planos e /documentos?tipo=proposta. Resto cai no upgrade modal
  // ou redireciona pro gerador. Admin e pagos passam direto.
  const isFree = user.plano === 'free';
  const isAdminUser = !!user.is_admin;
  if (isFree && !isAdminUser) {
    if (!hasCompany && pathname !== '/empresa') {
      router.replace('/empresa?welcome=1&plan=free');
      return null;
    }
    if (hasCompany) {
      const isGenerator = pathname === '/documentos' && searchParams.get('tipo') === 'proposta';
      const isAllowedExact = FREE_ALLOWED_PATHS.includes(pathname);
      if (!isGenerator && !isAllowedExact) {
        router.replace('/documentos?tipo=proposta');
        return null;
      }
    }
  }

  // Conta suspensa (D7 do dunning sem pagamento) → tela cheia bloqueando tudo
  // exceto atualização de cartão via Stripe billing portal. Stripe Smart Retries
  // continua tentando em paralelo; se o pagamento cair, o webhook reabre.
  if (user.billing_status === 'suspended') {
    return <BillingSuspendedPage email={user.email} />;
  }

  const docsRestantes = isFree ? Math.max(0, user.limite_documentos - (user.documentos_usados ?? 0)) : null;
  const limitReached = isFree && docsRestantes === 0;

  // Créditos esgotados → tela cheia de upgrade (sem sidebar, sem distrações)
  if (limitReached) {
    return <UpgradePage email={user.email} />;
  }

  return (
    <div className={styles.layout}>
      <Sidebar user={user} hasCompany={hasCompany} onUpgradeClick={() => setShowUpgrade(true)} />
      <main className={styles.main}>
        <TopBar userEmail={user.email} />
        <div className={styles.content}>
          {isFree && docsRestantes !== null && docsRestantes > 0 && (
            <div style={{
              background: docsRestantes <= 2 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${docsRestantes <= 2 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
              borderRadius: 10,
              padding: '10px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}>
              <span style={{ fontSize: 13, color: docsRestantes <= 2 ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                📄 Plano Gratuito — <strong>{docsRestantes} documento{docsRestantes !== 1 ? 's' : ''}</strong> restante{docsRestantes !== 1 ? 's' : ''} de 10.
              </span>
              <a href="/planos" style={{ fontSize: 12, fontWeight: 700, color: docsRestantes <= 2 ? '#ef4444' : '#f59e0b', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                Ver planos →
              </a>
            </div>
          )}
          {children}
        </div>
      </main>
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} plano={user.plano} />}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </DashboardProvider>
  );
}
