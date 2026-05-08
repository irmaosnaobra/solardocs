'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './login.module.css';

function EmailSentContent() {
  const params = useSearchParams();
  const email = params.get('e') ?? '';

  return (
    <div className={`${styles.card} ${styles.center}`}>
      <div className={styles.iconWrap} aria-hidden>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8"/>
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          <path d="m16 19 2 2 4-4"/>
        </svg>
      </div>

      <h1 className={styles.title}>Pronto. E-mail enviado.</h1>
      <p className={styles.subtitle}>
        Se {email ? <strong style={{ color: '#0f172a' }}>{email}</strong> : 'esse e-mail'} estiver cadastrado, você vai receber o link de
        recuperação em alguns segundos. <strong style={{ color: '#0f172a' }}>Confere a caixa de spam também</strong>, ok?
      </p>

      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Não recebeu em 5 minutos?{' '}
        <Link href="/auth?mode=esqueci" className={styles.link}>
          Tentar de novo
        </Link>
      </p>

      <Link href="/auth?mode=login" className={styles.linkBack}>
        ← Voltar pro login
      </Link>
    </div>
  );
}

export default function EmailSentForm() {
  return (
    <Suspense>
      <EmailSentContent />
    </Suspense>
  );
}
