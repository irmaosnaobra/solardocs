'use client';

import { useState } from 'react';
import Link from 'next/link';
import api from '@/services/api';
import styles from './login.module.css';

export default function EsqueciSenhaForm() {
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
      // O backend responde igual exista ou não o e-mail (anti-enumeração). Por isso
      // erro aqui é servidor ou rede falhando, e aí a pessoa NÃO pode ir pra tela de
      // "enviamos o link": ficaria esperando um e-mail que não saiu.
      await api.post('/auth/forgot-password', { email });
      // window.location e não router.push: o push para o mesmo /auth mudando só a query não navegava em produção (04/11/2026).
      // Sem setLoading(false) aqui: o botão fica carregando até a página trocar.
      window.location.assign(`/auth?mode=email-sent&e=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response
        ? (e.response.data?.error || 'Não deu certo agora. Tenta de novo em instantes.')
        : 'Não conseguimos conectar. Tenta de novo em instantes.');
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Esqueceu a senha? Tranquilo.</h1>
      <p className={styles.subtitle}>
        Coloca seu e-mail aqui embaixo. A gente manda o link no seu e-mail para você criar uma senha nova. Se você é assinante, ele chega também no WhatsApp da conta.
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
