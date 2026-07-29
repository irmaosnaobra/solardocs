'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  nome?: string | null;
  plano: string;
  documentos_usados: number;
  limite_documentos: number;
  is_admin?: boolean;
  billing_status?: 'active' | 'past_due' | 'suspended';
  past_due_since?: string | null;
  /** Comprou o kit na Kiwify. Vem do /auth/me — o layout usa pra não empurrar
   *  quem pagou por um CURSO pra tela de CNPJ do gerador. */
  tem_kit?: boolean;
}

interface DashboardContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  showUpgrade: boolean;
  setShowUpgrade: (show: boolean) => void;
  openUpgrade: () => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const openUpgrade = () => setShowUpgrade(true);

  return (
    <DashboardContext.Provider value={{ user, setUser, showUpgrade, setShowUpgrade, openUpgrade }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (context === undefined) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}
