'use client';

// Dark mode fixo desde 2026-05-21. Hook mantido pra não quebrar imports
// existentes; sempre retorna mode='dark' e pick é no-op.
export type ThemeMode = 'dark';
export const THEME_STORAGE_KEY = 'sd-theme';
export const DEFAULT_THEME: ThemeMode = 'dark';

export function useTheme() {
  return {
    mode: 'dark' as ThemeMode,
    pick: () => {},
    mounted: true,
  };
}
