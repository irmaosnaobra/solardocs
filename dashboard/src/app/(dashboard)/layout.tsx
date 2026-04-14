'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar/Sidebar';
import UpgradeModal from '@/components/UpgradeModal/UpgradeModal';
import { DashboardProvider, useDashboard } from '@/contexts/DashboardContext';
import { isAuthenticated } from '@/services/auth';
import api from '@/services/api';
import styles from './dashboard.module.css';

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, setUser, showUpgrade, setShowUpgrade } = useDashboard();
  const [hasCompany, setHasCompany] = useState(false);

  const fetchCompany = useCallback(() => {
    api.get('/company').then(({ data }) => {
      setHasCompany(!!data.company?.cnpj);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    api.get('/auth/me').then(({ data }) => {
      setUser(data.user);
      if (data.user?.is_admin) {
        setHasCompany(true);
        return;
      }
      fetchCompany();
    }).catch(() => {
      router.push('/login');
    });

    const handler = () => fetchCompany();
    window.addEventListener('company-saved', handler);
    return () => window.removeEventListener('company-saved', handler);
  }, [router, fetchCompany, setUser]);

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--color-text-muted)' }}>
        Carregando...
      </div>
    );
  }

  if (user.plano === 'free') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '24px', padding: '32px', textAlign: 'center', background: 'var(--color-bg)' }}>
        <span style={{ fontSize: '48px' }}>🔒</span>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-text)', margin: 0 }}>Acesso bloqueado</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '16px', maxWidth: '400px', margin: 0 }}>
          Seu acesso requer um plano ativo. Escolha o plano ideal e comece a gerar documentos profissionais.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '8px' }}>
          <a href="https://buy.stripe.com/test_bJe3cu1Y5fFK40s1OHfrW00" target="_blank" rel="noopener noreferrer"
            style={{ padding: '14px 28px', background: 'var(--color-border)', color: 'var(--color-text)', borderRadius: '8px', fontWeight: 700, textDecoration: 'none', fontSize: '15px' }}>
            Iniciante — R$27/mês
          </a>
          <a href="https://buy.stripe.com/eVqcN45ahbpu68AgJBfrW03" target="_blank" rel="noopener noreferrer"
            style={{ padding: '14px 28px', background: 'var(--color-border)', color: 'var(--color-text)', borderRadius: '8px', fontWeight: 700, textDecoration: 'none', fontSize: '15px' }}>
            PRO — R$47/mês
          </a>
          <a href="https://buy.stripe.com/bJe7sK6el9hmgNe0KDfrW02" target="_blank" rel="noopener noreferrer"
            style={{ padding: '14px 28px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', borderRadius: '8px', fontWeight: 700, textDecoration: 'none', fontSize: '15px' }}>
            VIP — R$97/mês ⭐
          </a>
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '8px' }}>
          Já pagou? <a href="/login" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Entre novamente</a> com o e-mail usado na compra.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <Sidebar
        user={user}
        hasCompany={hasCompany}
        onUpgradeClick={() => setShowUpgrade(true)}
      />
      <main className={styles.main}>
        {children}
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
