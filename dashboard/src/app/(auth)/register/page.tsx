'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import styles from './register.module.css';

const PLAN_LABEL: Record<string, string> = {
  iniciante: 'Iniciante',
  pro: 'PRO',
  ilimitado: 'VIP',
};

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('session');

  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                   = useState('');
  const [loading, setLoading]               = useState(false);
  const [planFromStripe, setPlanFromStripe] = useState<string | null>(null);

  // Se veio com ?session=, busca o e-mail e plano do Stripe
  useEffect(() => {
    if (!sessionId) return;
    api.get(`/payments/checkout-info/${sessionId}`)
      .then(r => {
        if (r.data.email) setEmail(r.data.email);
        if (r.data.plan)  setPlanFromStripe(r.data.plan);
      })
      .catch(() => {});
  }, [sessionId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) { setError('As senhas não coincidem'); return; }
    if (password.length < 6)          { setError('A senha deve ter pelo menos 6 caracteres'); return; }

    setLoading(true);
    try {
      const eventId = crypto.randomUUID();
      const { data } = await api.post('/auth/register', { email, password }, {
        headers: { 'X-Meta-Event-Id': eventId },
      });
      setToken(data.token);
      setUser(data.user);
      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'Lead', {}, { eventID: eventId });
      }
      router.push('/empresa');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      {planFromStripe && (
        <div className={styles.successBanner}>
          <span className={styles.successIcon}>✓</span>
          <div>
            <div className={styles.successTitle}>Pagamento confirmado!</div>
            <div className={styles.successSub}>
              Complete seu cadastro para acessar o plano{' '}
              <strong>{PLAN_LABEL[planFromStripe] ?? planFromStripe}</strong>.
            </div>
          </div>
        </div>
      )}

      <h1 className={styles.title}>
        {planFromStripe ? 'Complete seu cadastro' : 'Criar conta'}
      </h1>
      <p className={styles.subtitle}>
        {planFromStripe
          ? 'Use o mesmo e-mail do pagamento para ativar seu plano'
          : 'Comece a gerar documentos com IA'}
      </p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
            className="input-field"
            readOnly={!!planFromStripe}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Senha</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            className="input-field"
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Confirmar senha</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className="input-field"
            required
          />
        </div>

        {error && <p className="error-message">{error}</p>}

        <button type="submit" className="btn-primary" disabled={loading}
          style={{ width: '100%', marginTop: '8px' }}>
          {loading ? 'Criando conta...' : planFromStripe ? 'Ativar meu plano' : 'Criar conta'}
        </button>
      </form>

      <p className={styles.footer}>
        Já tem conta?{' '}
        <Link href="/login" className={styles.link}>Entrar</Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
