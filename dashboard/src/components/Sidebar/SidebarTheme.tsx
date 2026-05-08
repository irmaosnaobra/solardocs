'use client';

import { Sun, Monitor, Moon } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import styles from './Sidebar.module.css';

const ITEMS: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: 'light', icon: Sun,     label: 'Claro' },
  { mode: 'auto',  icon: Monitor, label: 'Automático' },
  { mode: 'dark',  icon: Moon,    label: 'Escuro' },
];

export default function SidebarTheme() {
  const { mode, pick, mounted } = useTheme();

  return (
    <div className={styles.navSection}>
      {ITEMS.map(item => {
        const active = mounted && mode === item.mode;
        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => pick(item.mode)}
            className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
            aria-pressed={active}
          >
            <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
            <span className={styles.navLabel}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
