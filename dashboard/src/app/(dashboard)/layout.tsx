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
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
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
