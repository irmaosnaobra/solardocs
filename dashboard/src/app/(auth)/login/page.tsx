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
  const [platform, setPlatform] = useState<'ios-chrome' | 'ios-safari' | 'android' | 'other' | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isIosChrome = isIos && /CriOS/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;

    if (isStandalone) { setInstalled(true); return; }
    setPlatform(isIos ? (isIosChrome ? 'ios-chrome' : 'ios-safari') : isAndroid ? 'android' : 'other');

    if ((window as any).__pwaInstallPrompt) {
      setInstallPrompt((window as any).__pwaInstallPrompt);
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      (window as any).__pwaInstallPrompt = e;
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

        <div style={{ textAlign: 'right', marginTop: '4px' }}>
          <Link href="/esqueci-senha" style={{ fontSize: '13px', color: '#f59e0b', textDecoration: 'none' }}>
            Esqueci minha senha
          </Link>
        </div>
      </form>

      <p className={styles.footer}>
        Não tem conta?{' '}
        <Link href="/register" className={styles.link}>
          Criar conta
        </Link>
      </p>

      {platform && !installed && (
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
            Instale o SolarDoc Pro na tela inicial e acesse na hora — sem abrir navegador.
          </p>

          {platform === 'ios-chrome' && (
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.8' }}>
              <p style={{ margin: '0 0 4px', fontWeight: '600', color: '#cbd5e1' }}>Como instalar no iPhone (Chrome):</p>
              <p style={{ margin: 0 }}>1. Toque nos <span style={{ color: '#f59e0b', fontWeight: '600' }}>3 pontos (⋯)</span> no canto inferior direito</p>
              <p style={{ margin: 0 }}>2. Toque em <span style={{ color: '#f59e0b', fontWeight: '600' }}>"Adicionar à tela de início"</span></p>
              <p style={{ margin: 0 }}>3. Confirme tocando em <span style={{ color: '#f59e0b', fontWeight: '600' }}>"Adicionar"</span></p>
            </div>
          )}

          {platform === 'ios-safari' && (
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.8' }}>
              <p style={{ margin: '0 0 4px', fontWeight: '600', color: '#cbd5e1' }}>Como instalar no iPhone (Safari):</p>
              <p style={{ margin: 0 }}>
                1. Toque no ícone{' '}
                <span style={{ color: '#f59e0b', fontWeight: '600' }}>
                  Compartilhar{' '}
                  <svg style={{ display: 'inline', verticalAlign: 'middle' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                  </svg>
                </span>
              </p>
              <p style={{ margin: 0 }}>2. Toque em <span style={{ color: '#f59e0b', fontWeight: '600' }}>"Adicionar à Tela de Início"</span></p>
              <p style={{ margin: 0 }}>3. Confirme tocando em <span style={{ color: '#f59e0b', fontWeight: '600' }}>"Adicionar"</span></p>
            </div>
          )}

          {platform === 'android' && installPrompt && (
            <button
              onClick={handleInstall}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '8px', width: '100%', padding: '11px',
                background: '#f59e0b', border: 'none', borderRadius: '8px',
                color: '#0f172a', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
              }}
            >
              Instalar agora
            </button>
          )}

          {platform === 'android' && !installPrompt && (
            <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.6', margin: 0 }}>
              No Chrome: toque nos <span style={{ color: '#f59e0b', fontWeight: '600' }}>3 pontos (⋮)</span> e selecione{' '}
              <span style={{ color: '#f59e0b', fontWeight: '600' }}>"Adicionar à tela inicial"</span>
            </p>
          )}
        </div>
      )}

      {installed && (
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#22c55e', fontWeight: '600' }}>
          ✅ App instalado!
        </p>
      )}
    </div>
  );
}
