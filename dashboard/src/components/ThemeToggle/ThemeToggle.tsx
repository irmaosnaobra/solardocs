'use client';

import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

type Mode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'sd-theme';

function applyTheme(mode: Mode) {
  const html = document.documentElement;
  const resolved =
    mode === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : mode;
  html.dataset.theme = resolved;
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Mode | null) ?? 'dark';
    setMode(stored);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme('auto');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  function pick(next: Mode) {
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

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
