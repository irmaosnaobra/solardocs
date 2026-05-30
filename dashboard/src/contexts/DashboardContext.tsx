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
}

interface DashboardContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  showUpgrade: boolean;
  setShowUpgrade: (show: boolean) => void;
  openUpgrade: () => void;
  // Desktop: sidebar expandida (ícones+texto) vs colapsada (só ícones). ☰ alterna.
  sidebarExpanded: boolean;
  toggleSidebar: () => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const openUpgrade = () => setShowUpgrade(true);
  const toggleSidebar = () => setSidebarExpanded((v) => !v);

  return (
    <DashboardContext.Provider value={{ user, setUser, showUpgrade, setShowUpgrade, openUpgrade, sidebarExpanded, toggleSidebar }}>
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
