'use client';

import { useState } from 'react';
import Link from 'next/link';
import api from '@/services/api';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {
      setError('Erro ao enviar email. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '16px',
      padding: '32px',
      animation: 'fadeIn 0.3s ease',
    }}>
      {sent ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📬</div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--color-text)', marginBottom: '10px' }}>
            Email enviado!
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: '1.6', marginBottom: '24px' }}>
            Se o email estiver cadastrado, você receberá um link para redefinir sua senha. Verifique também a caixa de spam.
          </p>
          <Link href="/login" style={{ color: '#f59e0b', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}>
            ← Voltar ao login
          </Link>
        </div>
      ) : (
        <>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--color-text)', marginBottom: '6px' }}>
            Esqueci minha senha
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '24px' }}>
            Informe seu email e enviaremos um link para redefinir sua senha.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: '500', color: 'var(--color-text-muted)' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="input-field"
                required
              />
            </div>

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Enviando...' : 'Enviar link de redefinição'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
            Lembrou a senha?{' '}
            <Link href="/login" style={{ color: '#f59e0b', fontWeight: '500', textDecoration: 'none' }}>
              Entrar
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
