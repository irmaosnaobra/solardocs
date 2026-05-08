'use client';

import { useTheme } from '@/hooks/useTheme';
import styles from './ThemeToggle.module.css';

export default function ThemeToggle() {
  const { mode, pick, mounted } = useTheme();

  if (!mounted) {
    return <div className={styles.placeholder} aria-hidden />;
  }

  return (
    <div className={styles.group} role="radiogroup" aria-label="Tema da interface">
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'light'}
        className={`${styles.btn} ${mode === 'light' ? styles.active : ''}`}
        onClick={() => pick('light')}
        title="Tema claro"
      >
        ☀️
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'auto'}
        className={`${styles.btn} ${mode === 'auto' ? styles.active : ''}`}
        onClick={() => pick('auto')}
        title="Automático (sistema)"
      >
        🖥️
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'dark'}
        className={`${styles.btn} ${mode === 'dark' ? styles.active : ''}`}
        onClick={() => pick('dark')}
        title="Tema escuro"
      >
        🌙
      </button>
    </div>
  );
}
