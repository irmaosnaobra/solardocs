'use client';

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import styles from './login.module.css';

function getStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string; cls: string } {
  if (!pw) return { score: 0, label: '', cls: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/\d/.test(pw)) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (score === 0) return { score: 0, label: 'fraca', cls: styles.strengthLabelWeak };
  if (score === 1) return { score: 1, label: 'fraca', cls: styles.strengthLabelWeak };
  if (score === 2) return { score: 2, label: 'média', cls: styles.strengthLabelMid };
  return { score: 3, label: 'forte', cls: styles.strengthLabelStrong };
}

function RedefinirSenhaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const strength = useMemo(() => getStrength(password), [password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('A senha precisa de pelo menos 8 caracteres.');
      return;
    }
    if (!/\d/.test(password)) {
      setError('A senha precisa ter pelo menos 1 número.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/reset-password', { token, password });
      // Login automático e redireciona pro dashboard.
      if (data.token) {
        setToken(data.token);
        if (data.user) setUser(data.user);
        router.push('/empresa?reset=ok');
      } else {
        router.push('/auth?mode=login&reset=ok');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Esse link expirou ou já foi usado. Solicita um novo abaixo.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className={`${styles.card} ${styles.center}`}>
        <div className={styles.iconWrap} aria-hidden style={{ background: '#fef2f2', color: '#b91c1c' }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        </div>
        <h1 className={styles.title}>Link inválido</h1>
        <p className={styles.subtitle}>
          Esse link de recuperação não é válido. Solicita um novo abaixo.
        </p>
        <Link href="/auth?mode=esqueci" className={styles.submit} style={{ display: 'inline-flex', textDecoration: 'none' }}>
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Cria sua nova senha.</h1>
      <p className={styles.subtitle}>
        Escolhe uma senha que você lembre. Pelo menos <strong style={{ color: '#0f172a' }}>8 caracteres com 1 número</strong>.
      </p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reset-pw">Nova senha</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            </span>
            <input
              id="reset-pw"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres + 1 número"
              className={styles.input}
              required
              minLength={8}
            />
            <button
              type="button"
              className={styles.inputToggle}
              onClick={() => setShowPw(s => !s)}
              aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
              tabIndex={-1}
            >
              {showPw ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>
          {password && (
            <>
              <div className={styles.strength} aria-hidden>
                <div className={`${styles.strengthBar} ${strength.score >= 1 ? styles.strengthBarActive : ''} ${strength.score === 3 ? styles.strengthBarStrong : ''}`} />
                <div className={`${styles.strengthBar} ${strength.score >= 2 ? styles.strengthBarActive : ''} ${strength.score === 3 ? styles.strengthBarStrong : ''}`} />
                <div className={`${styles.strengthBar} ${strength.score >= 3 ? styles.strengthBarStrong : ''}`} />
              </div>
              <span className={`${styles.strengthLabel} ${strength.cls}`}>
                Força: {strength.label}
              </span>
            </>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="reset-confirm">Confirmar senha</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            </span>
            <input
              id="reset-confirm"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repita a senha"
              className={styles.input}
              required
            />
          </div>
        </div>

        {error && <div className={styles.formError} role="alert">{error}</div>}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? <><span className={styles.spinner} /> Salvando...</> : 'Salvar nova senha'}
        </button>
      </form>

      <Link href="/auth?mode=login" className={styles.linkBack}>
        ← Voltar pro login
      </Link>
    </div>
  );
}

export default function RedefinirSenhaForm() {
  return (
    <Suspense>
      <RedefinirSenhaContent />
    </Suspense>
  );
}
