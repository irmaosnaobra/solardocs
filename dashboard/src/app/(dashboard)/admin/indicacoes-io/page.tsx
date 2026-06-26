'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/contexts/DashboardContext';
import IndicacoesIoPanel from '../_components/IndicacoesIoPanel';

export default function IndicacoesIoPage() {
  const { user } = useDashboard();
  const router = useRouter();

  useEffect(() => {
    if (user && !user.is_admin) router.replace('/dashboard');
  }, [user, router]);

  if (!user || !user.is_admin) return null;

  return <IndicacoesIoPanel />;
}
