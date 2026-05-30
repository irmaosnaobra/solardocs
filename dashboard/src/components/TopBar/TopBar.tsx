'use client';

import Link from 'next/link';
import { Search, Bell, HelpCircle, FileText } from 'lucide-react';
import styles from './TopBar.module.css';

interface TopBarProps {
  userEmail?: string;
}

export default function TopBar({ userEmail }: TopBarProps) {
  const initials = (userEmail || '?').slice(0, 1).toUpperCase();

  return (
    <header className={styles.topbar}>
      <Link href="/documentos?tipo=proposta" className={styles.brand}>
        <span className={styles.brandSolar}>Solar</span><span className={styles.brandDoc}>Doc</span>
      </Link>

      <div className={styles.search}>
        <Search size={16} className={styles.searchIcon} />
        <input className={styles.searchInput} placeholder="Buscar..." />
      </div>

      <div className={styles.actions}>
        <button className={styles.iconBtn} title="Buscar"><Search size={18} /></button>
        <button className={styles.iconBtn} title="Notificações"><Bell size={18} /></button>
        <button className={styles.iconBtn} title="Documentos"><FileText size={18} /></button>
        <button className={styles.iconBtn} title="Ajuda"><HelpCircle size={18} /></button>
        <div className={styles.avatar} title={userEmail}>{initials}</div>
      </div>
    </header>
  );
}
