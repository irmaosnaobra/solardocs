'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './InfoHint.module.css';

/**
 * "?" pequeno ao lado de um rótulo. No PC mostra no hover; no celular, no toque.
 * Uso: <label>Campo <InfoHint>Texto de ajuda...</InfoHint></label>
 * Substitui as legendas soltas embaixo dos campos — só aparece quando o usuário pede.
 */
export default function InfoHint({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Toque fora / Esc fecha (mobile).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.btn}
        aria-label="Ajuda"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
      >
        ?
      </button>
      <span role="tooltip" className={`${styles.pop} ${open ? styles.open : ''}`}>{children}</span>
    </span>
  );
}
