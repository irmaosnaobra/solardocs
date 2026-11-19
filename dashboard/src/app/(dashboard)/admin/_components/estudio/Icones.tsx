// Ícones das redes, desenhados em SVG monocromático (herdam currentColor).
import type { Rede } from './tipos';

interface Props { rede: Rede; size?: number; className?: string }

export function IconeRede({ rede, size = 18, className }: Props) {
  const comum = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true as const, focusable: false as const };
  if (rede === 'instagram') {
    return (
      <svg {...comum} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.1" />
        <circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (rede === 'youtube') {
    return (
      <svg {...comum} fill="currentColor">
        <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.29 5 12 5 12 5s-6.29 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.71 19 12 19 12 19s6.29 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
      </svg>
    );
  }
  return (
    <svg {...comum} fill="currentColor">
      <path d="M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.3 6.2V8.6a7.9 7.9 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.4V2Z" />
    </svg>
  );
}
