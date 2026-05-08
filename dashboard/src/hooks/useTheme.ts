'use client';

import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';
export const THEME_STORAGE_KEY = 'sd-theme';
export const DEFAULT_THEME: ThemeMode = 'light';

function applyTheme(mode: ThemeMode) {
  const html = document.documentElement;
  const resolved =
    mode === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : mode;
  html.dataset.theme = resolved;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null) ?? DEFAULT_THEME;
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

  function pick(next: ThemeMode) {
    setMode(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }

  return { mode, pick, mounted };
}
