'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import styles from './login.module.css';

type Platform = 'ios-chrome' | 'ios-safari' | 'android' | 'other' | null;

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // PWA install (mantido)
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => void; userChoice: Promise<{ outcome: string }> } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isIosChrome = isIos && /CriOS/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) { setInstalled(true); return; }
    setPlatform(isIos ? (isIosChrome ? 'ios-chrome' : 'ios-safari') : isAndroid ? 'android' : 'other');

    const w = window as unknown as { __pwaInstallPrompt?: { prompt: () => void; userChoice: Promise<{ outcome: string }> } };
    if (w.__pwaInstallPrompt) setInstallPrompt(w.__pwaInstallPrompt);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as unknown as { prompt: () => void; userChoice: Promise<{ outcome: string }> });
      w.__pwaInstallPrompt = e as unknown as { prompt: () => void; userChoice: Promise<{ outcome: string }> };
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setInstallPrompt(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await api.post('/auth/login', { email, password });
      setToken(data.token);
      setUser(data.user);
      router.push('/empresa');
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { error?: string } } };
      // Mensagem genérica por segurança (não dizer qual dos campos errou)
      if (error.response?.status === 401 || error.response?.status === 400) {
        setError('E-mail ou senha incorretos.');
      } else if (!error.response) {
        setError('Não conseguimos conectar. Tenta de novo em instantes.');
      } else {
        setError(error.response?.data?.error || 'Erro ao entrar. Tenta de novo.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Bem-vindo de volta</h1>
      <p className={styles.subtitle}>Entre para continuar de onde parou.</p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-email">E-mail</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
            </span>
            <input
              id="login-email"
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

        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-password">Senha</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            </span>
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              className={styles.input}
              required
            />
            <button
              type="button"
              className={styles.inputToggle}
              onClick={() => setShowPassword(s => !s)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>
        </div>

        <div className={styles.actionRow}>
          <Link href="/auth?mode=esqueci" className={styles.actionLink}>
            Esqueci minha senha
          </Link>
        </div>

        {error && <div className={styles.formError} role="alert">{error}</div>}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? <><span className={styles.spinner} /> Entrando...</> : 'Entrar'}
        </button>
      </form>

      <p className={styles.footer}>
        Não tem conta?{' '}
        <Link href="/#planos" className={styles.link}>
          Veja os planos
        </Link>
      </p>

      {platform && !installed && platform !== 'other' && (
        <div className={styles.pwaHint}>
          <div className={styles.pwaHintTitle}>Use como app no seu celular</div>
          <div className={styles.pwaHintText}>
            Instale o SolarDoc Pro na tela inicial e acesse na hora — sem abrir navegador.
          </div>
          {platform === 'ios-chrome' && (
            <div className={styles.pwaHintText}>
              <strong>iPhone (Chrome):</strong> 3 pontos (⋯) → "Adicionar à tela de início"
            </div>
          )}
          {platform === 'ios-safari' && (
            <div className={styles.pwaHintText}>
              <strong>iPhone (Safari):</strong> ícone Compartilhar → "Adicionar à Tela de Início"
            </div>
          )}
          {platform === 'android' && installPrompt && (
            <button onClick={handleInstall} className={styles.pwaHintBtn}>
              Instalar agora
            </button>
          )}
          {platform === 'android' && !installPrompt && (
            <div className={styles.pwaHintText}>
              <strong>Chrome:</strong> 3 pontos (⋮) → "Adicionar à tela inicial"
            </div>
          )}
        </div>
      )}

      {installed && (
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>
          App instalado!
        </p>
      )}
    </div>
  );
}
