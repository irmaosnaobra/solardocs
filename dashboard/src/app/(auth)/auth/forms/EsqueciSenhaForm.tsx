'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import styles from './login.module.css';

export default function EsqueciSenhaForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Digite seu e-mail.');
      return;
    }
    setLoading(true);
    try {
      // Backend SEMPRE retorna sucesso (mesmo se email não existir) — anti-enumeration.
      await api.post('/auth/forgot-password', { email });
    } catch {
      // Falha de rede silenciosa — segue pro email-sent (não vazar nada).
    } finally {
      setLoading(false);
      router.push(`/auth?mode=email-sent&e=${encodeURIComponent(email)}`);
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Esqueceu a senha? Tranquilo.</h1>
      <p className={styles.subtitle}>
        Coloca seu e-mail aqui embaixo. A gente manda um link pra você criar uma nova em menos de 1 minuto.
      </p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="forgot-email">E-mail cadastrado</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
            </span>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className={styles.input}
              required
            />
          </div>
        </div>

        {error && <div className={styles.formError} role="alert">{error}</div>}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? <><span className={styles.spinner} /> Enviando...</> : 'Enviar link de recuperação'}
        </button>
      </form>

      <Link href="/auth?mode=login" className={styles.linkBack}>
        ← Voltar pro login
      </Link>
    </div>
  );
}
