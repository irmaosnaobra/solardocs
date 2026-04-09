'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  plano: string;
  documentos_usados: number;
  limite_documentos: number;
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
