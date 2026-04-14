'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    setIsIos(ios);
    setIsStandalone(standalone);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
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
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Entrar</h1>
      <p className={styles.subtitle}>Acesse sua conta SolarDoc Pro</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            className="input-field"
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="input-field"
            required
          />
        </div>

        {error && <p className="error-message">{error}</p>}

        <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', marginTop: '8px' }}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className={styles.footer}>
        Não tem conta?{' '}
        <Link href="/register" className={styles.link}>
          Criar conta
        </Link>
      </p>

      {!isStandalone && (
        <div style={{
          marginTop: '20px',
          padding: '16px',
          background: 'rgba(245,158,11,0.07)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: '12px',
        }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: '#f59e0b', marginBottom: '4px' }}>
            📲 Use como app no seu celular
          </p>
          <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px', lineHeight: '1.5' }}>
            Instale o SolarDoc Pro na tela inicial do seu celular e acesse na hora — sem abrir navegador.
          </p>

          {installPrompt && !installed && (
            <button
              onClick={handleInstall}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '11px',
                background: '#f59e0b',
                border: 'none',
                borderRadius: '8px',
                color: '#0f172a',
                fontSize: '13px',
                fontWeight: '700',
                cursor: 'pointer',
              }}
            >
              Instalar agora
            </button>
          )}

          {installed && (
            <p style={{ fontSize: '13px', color: '#22c55e', textAlign: 'center', fontWeight: '600' }}>
              ✅ App instalado com sucesso!
            </p>
          )}

          {isIos && !installed && (
            <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.6', textAlign: 'center' }}>
              No iPhone: toque em{' '}
              <span style={{ color: '#f59e0b', fontWeight: '600' }}>
                Compartilhar (
                <svg style={{ display: 'inline', verticalAlign: 'middle' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                </svg>
                )
              </span>{' '}
              e depois em{' '}
              <span style={{ color: '#f59e0b', fontWeight: '600' }}>"Adicionar à Tela de Início"</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
