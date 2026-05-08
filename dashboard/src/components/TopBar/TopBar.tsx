'use client';

import ThemeToggle from '../ThemeToggle/ThemeToggle';
import styles from './TopBar.module.css';

interface TopBarProps {
  userEmail?: string;
}

export default function TopBar({ userEmail }: TopBarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.spacer} />
      <div className={styles.controls}>
        {userEmail && <span className={styles.email} title={userEmail}>{userEmail}</span>}
        <ThemeToggle />
      </div>
    </header>
  );
}
