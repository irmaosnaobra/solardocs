'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/contexts/DashboardContext';
import LinksIoPanel from '../_components/LinksIoPanel';

export default function LinksIoPage() {
  const { user } = useDashboard();
  const router = useRouter();

  // Gate de admin — mesmo padrão do /admin/insights.
  useEffect(() => {
    if (user && !user.is_admin) router.replace('/dashboard');
  }, [user, router]);

  if (!user || !user.is_admin) return null;

  return <LinksIoPanel />;
}
